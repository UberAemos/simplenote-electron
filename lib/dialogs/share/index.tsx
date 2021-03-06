import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { includes, isEmpty } from 'lodash';
import MD5 from 'md5.js';

import analytics from '../../analytics';
import ClipboardButton from '../../components/clipboard-button';
import isEmailTag from '../../utils/is-email-tag';
import { updateNoteTags } from '../../state/domain/notes';
import Dialog from '../../dialog';
import TabPanels from '../../components/tab-panels';
import PanelTitle from '../../components/panel-title';
import ToggleControl from '../../controls/toggle';
import { closeDialog, publishNote } from '../../state/ui/actions';

import * as S from '../../state';
import * as T from '../../types';

const shareTabs = ['collaborate', 'publish'];

type StateProps = {
  settings: S.State['settings'];
  note: T.NoteEntity;
};

type DispatchProps = {
  closeDialog: () => any;
  publishNote: (note: T.NoteEntity, shouldPublish: boolean) => any;
  updateNoteTags: (args: { note: T.NoteEntity; tags: T.TagName[] }) => any;
};

type Props = StateProps & DispatchProps;

export class ShareDialog extends Component<Props> {
  onTogglePublished = (event: React.MouseEvent<HTMLInputElement>) => {
    this.props.publishNote(this.props.note, event.currentTarget.checked);
  };

  getPublishURL = (url) =>
    isEmpty(url) ? undefined : `http://simp.ly/p/${url}`;

  onAddCollaborator = (event) => {
    const { note } = this.props;
    const tags = (note.data && note.data.tags) || [];
    const collaborator = this.collaboratorElement.value.trim();

    event.preventDefault();
    this.collaboratorElement.value = '';

    const isSelf = this.props.settings.accountName === collaborator;

    if (collaborator !== '' && tags.indexOf(collaborator) === -1 && !isSelf) {
      this.props.updateNoteTags({
        note,
        tags: [...tags, collaborator],
      });
      analytics.tracks.recordEvent('editor_note_collaborator_added');
    }
  };

  onRemoveCollaborator = (collaborator) => {
    const { note } = this.props;

    let tags = (note.data && note.data.tags) || [];
    tags = tags.filter((tag) => tag !== collaborator);

    this.props.updateNoteTags({ note, tags });
    analytics.tracks.recordEvent('editor_note_collaborator_removed');
  };

  collaborators = () => {
    const { note } = this.props;
    const tags = (note.data && note.data.tags) || [];
    const collaborators = tags.filter(isEmailTag);

    collaborators.reverse();

    return collaborators;
  };

  gravatarURL = (email) => {
    const hash = new MD5()
      .update(email.trim().toLowerCase())
      .digest('hex')
      .toLowerCase();

    return `https://secure.gravatar.com/avatar/${hash}.jpg?s=68`;
  };

  render() {
    const { closeDialog, note } = this.props;
    const data = (note && note.data) || {};
    const isPublished = includes(data.systemTags, 'published');
    const publishURL = this.getPublishURL(data.publishURL);

    return (
      <Dialog className="settings" title="Share" onDone={closeDialog}>
        <TabPanels tabNames={shareTabs}>
          <div>
            <div className="settings-group">
              <p>
                Add an email address of another Simplenote user to share a note.
                You&apos;ll both be able to edit and view the note.
              </p>
              <div className="settings-items theme-color-border">
                <form
                  className="settings-item theme-color-border"
                  onSubmit={this.onAddCollaborator}
                >
                  <input
                    className="settings-item-text-input transparent-input"
                    // Regex to detect valid email
                    pattern="^[^@]+@.+"
                    placeholder="email@example.com"
                    ref={(e) => (this.collaboratorElement = e)}
                    spellCheck={false}
                    title="Please enter a valid email"
                  />
                  <div className="settings-item-control">
                    <button type="submit" className="button button-borderless">
                      Add Email
                    </button>
                  </div>
                </form>
              </div>
            </div>
            <div className="settings-group">
              <div className="share-collaborators-heading theme-color-border">
                <PanelTitle headingLevel="3">Collaborators</PanelTitle>
              </div>
              <ul className="share-collaborators">
                {this.collaborators().map((collaborator) => (
                  <li key={collaborator} className="share-collaborator">
                    <span className="share-collaborator-photo">
                      <img
                        src={this.gravatarURL(collaborator)}
                        width="34"
                        height="34"
                      />
                    </span>
                    <span className="share-collaborator-name">
                      {collaborator}
                    </span>
                    <button
                      className="share-collaborator-remove button button-borderless button-danger"
                      onClick={this.onRemoveCollaborator.bind(
                        this,
                        collaborator
                      )}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <div className="settings-group">
              <div className="settings-items theme-color-border">
                <label
                  htmlFor="settings-field-public"
                  className="settings-item theme-color-border"
                >
                  <div className="settings-item-label">Make public link</div>
                  <div className="settings-item-control">
                    <ToggleControl
                      id="settings-field-public"
                      onChange={this.onTogglePublished}
                      checked={isPublished}
                    />
                  </div>
                </label>
              </div>
              <p>
                Ready to share your note with the world? Anyone with the public
                link will be able to view the latest version.
              </p>
            </div>
            {isPublished && (
              <div className="settings-group">
                <PanelTitle headingLevel="3">Public link</PanelTitle>
                <div className="settings-items theme-color-border">
                  <div className="settings-item theme-color-border">
                    <input
                      ref={(e) => (this.publishUrlElement = e)}
                      className="settings-item-text-input transparent-input"
                      placeholder={
                        isPublished ? 'Publishing note…' : 'Note not published'
                      }
                      value={publishURL}
                      spellCheck={false}
                    />
                    <div className="settings-item-control">
                      {publishURL && <ClipboardButton text={publishURL} />}
                    </div>
                  </div>
                </div>
                {publishURL && <p>Note published!</p>}
              </div>
            )}
          </div>
        </TabPanels>
      </Dialog>
    );
  }
}

const mapStateToProps: S.MapState<StateProps> = ({
  settings,
  ui: { note },
}) => ({
  settings,
  note,
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = (dispatch) => ({
  closeDialog: () => dispatch(closeDialog()),
  publishNote: (note, shouldPublish) =>
    dispatch(publishNote(note, shouldPublish)),
  updateNoteTags: ({ note, tags }) => dispatch(updateNoteTags({ note, tags })),
});

export default connect(mapStateToProps, mapDispatchToProps)(ShareDialog);
