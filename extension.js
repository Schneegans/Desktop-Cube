//////////////////////////////////////////////////////////////////////////////////////////
// ,-.  ,--.  ,-.  ,  , ,---.  ,-.  ;-.     ,-. .  . ,-.  ,--. This software may be     //
// |  \ |    (   ` | /    |   /   \ |  )   /    |  | |  ) |    modified and distributed //
// |  | |-    `-.  |<     |   |   | |-'    |    |  | |-<  |-   under the MIT license.   //
// |  / |    .   ) | \    |   \   / |      \    |  | |  ) |    See the LICENSE file     //
// `-'  `--'  `-'  '  `   '    `-'  '       `-' `--` `-'  `--' for details.             //
//////////////////////////////////////////////////////////////////////////////////////////

'use strict';

const Main             = imports.ui.main;
const OverviewControls = imports.ui.overviewControls;
const WorkspacesView   = imports.ui.workspacesView.WorkspacesView;
const FitMode          = imports.ui.workspacesView.FitMode;
const Util             = imports.misc.util;

const ExtensionUtils = imports.misc.extensionUtils;
const Me             = imports.misc.extensionUtils.getCurrentExtension();

//////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////

class Extension {
  // The constructor is called once when the extension is loaded, not enabled.
  constructor() {
    this._origUpdateWorkspacesState = null;
    this._origgetSpacing            = null;
    this._origupdateVisibility      = null;
    this._lastWorkspaceWidth        = 0;
  }

  // This function could be called after the extension is enabled, which could be done
  // from GNOME Tweaks, when you log in or when the screen is unlocked.
  enable() {

    this._origUpdateWorkspacesState = WorkspacesView.prototype._updateWorkspacesState;
    this._origgetSpacing            = WorkspacesView.prototype._getSpacing;
    this._origupdateVisibility      = WorkspacesView.prototype._updateVisibility;

    const extensionThis = this;

    WorkspacesView.prototype._updateVisibility = function() {
      this._workspaces.forEach((w) => {
        w.show();
      });
    };

    WorkspacesView.prototype._getSpacing = function(box, fitMode, vertical) {
      const origValue =
          extensionThis._origgetSpacing.apply(this, [box, fitMode, vertical]);

      if (fitMode == FitMode.ALL) {
        return origValue;
      }

      const [, height] = box.get_size();
      const [workspace] = this._workspaces;

      const [, workspaceWidth] = workspace.get_preferred_width(height);
      const overlapValue = -workspaceWidth;

      const {initialState, finalState, progress} =
          this._overviewAdjustment.getStateTransitionParams();

      const workspaceMode = Util.lerp(
          this._getWorkspaceModeForOverviewState(initialState),
          this._getWorkspaceModeForOverviewState(finalState), progress);

      return origValue * (1 - workspaceMode) + workspaceMode * overlapValue;
    };


    WorkspacesView.prototype._updateWorkspacesState = function(...params) {
      const {initialState, finalState, progress} =
          this._overviewAdjustment.getStateTransitionParams();

      const overviewMode = Util.lerp(
          this._getWorkspaceModeForOverviewState(initialState),
          this._getWorkspaceModeForOverviewState(finalState), progress);

      const appGridMode = Util.lerp(
          extensionThis._getWorkspaceModeForAppGridState(initialState),
          extensionThis._getWorkspaceModeForAppGridState(finalState), progress);

      const faceCount = this._workspaces.length;

      if (faceCount <= 1) {
        return;
      }

      const [workspace] = this._workspaces;

      let workspaceWidth = this._lastWorkspaceWidth;

      if (workspace._background.get_stage() && workspace._background.width > 0) {
        workspaceWidth = this._lastWorkspaceWidth = workspace._background.width;
      }

      const maxAngle    = (faceCount == 2 ? 90 : 180);
      const faceAngle   = maxAngle / (faceCount - 1);
      const centerDepth = workspaceWidth / 2 / Math.atan(faceAngle * 0.5 * Math.PI / 180);

      this._workspaces.forEach((w, index) => {
        // Update corner radii
        w.stateAdjustment.value = overviewMode;

        // Update rotation.
        w.pivot_point_z = overviewMode * -centerDepth;
        w.rotation_angle_y =
            overviewMode * (-this._scrollAdjustment.value + index) * faceAngle;

        w._background.translation_z = overviewMode * -50;

        const distanceToCurrentWorkspace = Math.abs(this._scrollAdjustment.value - index);
        const scaleProgress = 1 - Math.clamp(distanceToCurrentWorkspace, 0, 1);

        // Update opacity only in overview mode.
        let opacity = Util.lerp(200, 255, scaleProgress);
        opacity     = 255 * (1 - overviewMode) + opacity * overviewMode;
        w._background.set_opacity(opacity);

        // Update scale only in app grid mode.
        let scale = Util.lerp(
            imports.ui.workspacesView.WORKSPACE_INACTIVE_SCALE, 1, scaleProgress);
        scale = (1 - appGridMode) + scale * appGridMode;
        w.set_scale(scale, scale);
      });

      // Compute distance of virtual camera to the workspaces plane. Required for depth
      // sorting.
      const monitorHeight = Main.layoutManager.monitors[this._monitorIndex].height;
      const camDist       = monitorHeight /
          (2 * Math.tan(global.stage.perspective.fovy / 2 * Math.PI / 180));

      // Depth sort
      const workspaces = this._workspaces.slice();
      workspaces.sort((a, b) => {
        return Math.abs(a.rotation_angle_y) - Math.abs(b.rotation_angle_y);
      });


      for (let i = 1; i < workspaces.length; i++) {
        const w = workspaces[i];
        w.get_parent().set_child_below_sibling(w, workspaces[i - 1]);
      }

      for (let i = 0; i < this._workspaces.length; i++) {
        const w = this._workspaces[i];

        if (w.rotation_angle_y == 0) {

          w.set_child_below_sibling(w._background, null);

        } else {
          const a     = camDist + centerDepth;
          const b     = centerDepth;
          const gamma = Math.abs(w.rotation_angle_y);

          // Kosinussatz c²=a²+b²-2ab*cos(gamma)
          const c =
              Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(gamma * Math.PI / 180));

          // Kosinussatz alpha=acos((b²+c²-a²)(2bc))
          const alpha = Math.acos((b * b + c * c - a * a) / (2 * b * c)) * 180 / Math.PI;

          if (alpha > 90) {
            w.set_child_below_sibling(w._background, null);
          } else {
            w.set_child_above_sibling(w._background, null);
          }
        }
      }
    };
  }

  // This function could be called after the extension is uninstalled, disabled in GNOME
  // Tweaks, when you log out or when the screen locks.
  disable() {
    WorkspacesView.prototype._updateWorkspacesState = this._origUpdateWorkspacesState;
    WorkspacesView.prototype._getSpacing            = this._origgetSpacing;
    WorkspacesView.prototype._updateVisibility      = this._origupdateVisibility;
  }

  _getWorkspaceModeForAppGridState(state) {
    const {ControlsState} = OverviewControls;

    switch (state) {
      case ControlsState.HIDDEN:
        return 0;
      case ControlsState.WINDOW_PICKER:
        return 0;
      case ControlsState.APP_GRID:
        return 1;
    }

    return 0;
  }
}

// This function is called once when the extension is loaded, not enabled.
function init() {
  return new Extension();
}
