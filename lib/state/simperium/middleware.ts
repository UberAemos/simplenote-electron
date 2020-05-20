import { default as createClient } from 'simperium';

import debugFactory from 'debug';
import actions from '../actions';
import { InMemoryBucket } from './functions/in-memory-bucket';
import { NoteBucket } from './functions/note-bucket';
import { ReduxGhost } from './functions/redux-ghost';
import { TagBucket } from './functions/tag-bucket';
import { start as startConnectionMonitor } from './functions/connection-monitor';
import { getAccountName } from './functions/username-monitor';

import * as A from '../action-types';
import * as S from '../';
import * as T from '../../types';

const debug = debugFactory('simperium-middleware');

type Buckets = {
  note: T.Note;
  preferences: T.Preferences;
  tag: T.Tag;
};

export const initSimperium = (
  logout: () => any,
  token: string,
  username: string | null,
  createWelcomeNote: boolean
): S.Middleware => (store) => {
  const { dispatch, getState } = store;

  const client = createClient<Buckets>('chalk-bump-f49', token, {
    objectStoreProvider: (bucket) => {
      switch (bucket.name) {
        case 'note':
          return new NoteBucket(store);

        case 'preferences':
          return new InMemoryBucket();

        case 'tag':
          return new TagBucket(store);
      }
    },
    ghostStoreProvider: (bucket) => new ReduxGhost(bucket.name, store),
  });
  client.on('unauthorized', () => logout());

  getAccountName(client).then((accountName) => {
    debug(`authenticated: ${accountName}`);
    dispatch(actions.settings.setAccountName(accountName));
  });

  startConnectionMonitor(client, store);

  const noteBucket = client.bucket('note');
  noteBucket.on('update', (entityId, updatedEntity, remoteInfo) => {
    dispatch({
      type: 'REMOTE_NOTE_UPDATE',
      noteId: entityId,
      note: updatedEntity,
      remoteInfo,
    });
  });

  noteBucket.channel.localQueue.on('send', (change) => {
    dispatch({
      type: 'SUBMIT_PENDING_CHANGE',
      entityId: change.id,
      ccid: change.ccid,
    });
  });

  noteBucket.channel.on('acknowledge', (entityId, change) => {
    dispatch({
      type: 'ACKNOWLEDGE_PENDING_CHANGE',
      entityId: entityId,
      ccid: change.ccid,
    });
  });

  const tagBucket = client.bucket('tag');
  tagBucket.on('update', (entityId, updatedEntity, remoteInfo) => {
    dispatch({
      type: 'REMOTE_TAG_UPDATE',
      tagId: entityId,
      tag: updatedEntity,
      remoteInfo,
    });
  });

  const preferencesBucket = client.bucket('preferences');
  preferencesBucket.channel.on('update', (entityId, updatedEntity) => {
    if ('preferences-key' !== entityId) {
      return;
    }

    dispatch({
      type: 'SET_ANALYTICS',
      allowAnalytics: !!updatedEntity.analytics_enabled,
    });
  });

  if (createWelcomeNote) {
    import(
      /* webpackChunkName: 'welcome-message' */ '../../welcome-message'
    ).then(({ content }) => {
      const now = Date.now() / 1000;
      noteBucket.add({
        content,
        deleted: false,
        systemTags: [],
        creationDate: now,
        modificationDate: now,
        shareURL: '',
        publishURL: '',
        tags: [],
      });
    });
  }

  const changedNotes = new Map<T.EntityId, any>();
  const queueNoteUpdate = (noteId: T.EntityId) => {
    if (changedNotes.has(noteId)) {
      clearTimeout(changedNotes.get(noteId));
    }

    const timer = setTimeout(() => noteBucket.touch(noteId), 2000);
    changedNotes.set(noteId, timer);
  };

  const changedTags = new Map<T.EntityId, any>();
  const queueTagUpdate = (tagId: T.EntityId) => {
    if (changedTags.has(tagId)) {
      clearTimeout(changedTags.get(tagId));
    }

    const timer = setTimeout(() => tagBucket.touch(tagId), 20);
    changedTags.set(tagId, timer);
  };

  return (next) => (action: A.ActionType) => {
    console.log(action);
    const prevState = store.getState();
    const result = next(action);
    const nextState = store.getState();

    switch (action.type) {
      case 'ADD_NOTE_TAG':
        if (prevState.data.tags[1].has(action.tagName.toLocaleLowerCase())) {
          queueTagUpdate(
            nextState.data.tags[1].get(action.tagName.toLocaleLowerCase())
          );
        } else {
          tagBucket.add({ name: action.tagName }).then((tag) =>
            dispatch({
              type: 'CONFIRM_NEW_TAG',
              tagName: action.tagName,
              originalTagId: nextState.data.tags[1].get(
                action.tagName.toLocaleLowerCase()
              ),
              newTagId: tag.id,
              tag: tag.data,
            })
          );
        }
        queueNoteUpdate(action.noteId);
        return result;

      case 'REMOVE_NOTE_TAG':
        queueNoteUpdate(action.noteId);
        return result;

      // while editing we should debounce
      // updates to prevent thrashing
      case 'CREATE_NOTE_WITH_ID':
        noteBucket
          .add({
            content: '',
            tags: [],
            creationDate: Date.now() / 1000,
            modificationDate: Date.now() / 1000,
            deleted: false,
            systemTags: [],
            shareURL: '',
            publishURL: '',
            ...action.note,
          })
          .then((note) =>
            dispatch({
              type: 'CONFIRM_NEW_NOTE',
              originalNoteId: action.noteId,
              newNoteId: note.id,
              note: note.data,
            })
          );
        return result;

      case 'INSERT_TASK_INTO_NOTE':
      case 'EDIT_NOTE':
        queueNoteUpdate(action.noteId);
        return result;

      case 'FILTER_NOTES':
      case 'OPEN_NOTE':
      case 'SELECT_NOTE': {
        const noteId =
          action.noteId ??
          action.meta?.nextNoteToOpen ??
          getState().ui.openedNote;

        if (noteId) {
          setTimeout(() => {
            if (getState().ui.openedNote === noteId) {
              noteBucket.getRevisions(noteId).then((revisions) => {
                dispatch({
                  type: 'LOAD_REVISIONS',
                  noteId: noteId,
                  revisions: revisions
                    .map(({ data, version }) => [version, data])
                    .sort((a, b) => a[0] - b[0]),
                });
              });
            }
          }, 250);
        }

        return result;
      }

      // other note editing actions however
      // should trigger an immediate sync
      case 'IMPORT_NOTE_WITH_ID':
      case 'MARKDOWN_NOTE':
      case 'PIN_NOTE':
      case 'PUBLISH_NOTE':
      case 'RESTORE_NOTE':
      case 'RESTORE_NOTE_REVISION':
      case 'TRASH_NOTE':
        setTimeout(() => noteBucket.touch(action.noteId), 10);
        return result;

      case 'DELETE_NOTE_FOREVER':
        setTimeout(() => noteBucket.remove(action.noteId), 10);
        return result;

      case 'RENAME_TAG': {
        const tagId = prevState.data.tags[1].get(
          action.oldTagName.toLocaleLowerCase()
        );
        if (tagId) {
          queueTagUpdate(tagId);
        }
        return result;
      }

      case 'REORDER_TAG':
        // if one tag changes order we likely have to synchronize all tags…
        nextState.data.tags[0].forEach((tag, tagId) => {
          queueTagUpdate(tagId);
        });
        return result;

      case 'SET_ANALYTICS':
        preferencesBucket.get('preferences-key').then((preferences) => {
          preferencesBucket.update(
            'preferences-key',
            {
              ...preferences.data,
              analytics_enabled: action.allowAnalytics,
            },
            { sync: true }
          );
        });
        return result;

      case 'TOGGLE_ANALYTICS':
        preferencesBucket.get('preferences-key').then((preferences) => {
          preferencesBucket.update(
            'preferences-key',
            {
              ...preferences.data,
              analytics_enabled: !preferences.data.analytics_enabled,
            },
            { sync: true }
          );
        });
        return result;

      case 'TRASH_TAG': {
        const tagId = prevState.data.tags[1].get(
          action.tagName.toLocaleLowerCase()
        );

        if (tagId) {
          tagBucket.remove(tagId);
        }

        return result;
      }

      case 'LOGOUT':
        client.end();
        logout();
        return result;
    }

    return result;
  };
};
