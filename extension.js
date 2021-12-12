//////////////////////////////////////////////////////////////////////////////////////////
// ,-.  ,--.  ,-.  ,  , ,---.  ,-.  ;-.     ,-. .  . ,-.  ,--.       Copyright (c) 2021 //
// |  \ |    (   ` | /    |   /   \ |  )   /    |  | |  ) |            Simon Schneegans //
// |  | |-    `-.  |<     |   |   | |-'    |    |  | |-<  |-   Released under the GPLv3 //
// |  / |    .   ) | \    |   \   / |      \    |  | |  ) |       or later. See LICENSE //
// `-'  `--'  `-'  '  `   '    `-'  '       `-' `--` `-'  `--'        file for details. //
//////////////////////////////////////////////////////////////////////////////////////////

'use strict';

const Main             = imports.ui.main;
const OverviewControls = imports.ui.overviewControls;
const WorkspacesView   = imports.ui.workspacesView.WorkspacesView;
const FitMode          = imports.ui.workspacesView.FitMode;
const Util             = imports.misc.util;

const ExtensionUtils = imports.misc.extensionUtils;
const Me             = imports.misc.extensionUtils.getCurrentExtension();
const utils          = Me.imports.utils;

//////////////////////////////////////////////////////////////////////////////////////////
// This extensions modifies three methods of the WorkspacesView class of GNOME Shell.   //
// By doing this, it tweaks the positioning of workspaces in overview mode to make them //
// look like cube faces.                                                                //
//////////////////////////////////////////////////////////////////////////////////////////

// The scale of inactive workspaces in app grid mode.
const INACTIVE_SCALE = imports.ui.workspacesView.WORKSPACE_INACTIVE_SCALE;

class Extension {
  // The constructor is called once when the extension is loaded, not enabled.
  constructor() {
    this._origUpdateWorkspacesState = null;
    this._origGetSpacing            = null;
    this._origUpdateVisibility      = null;
    this._lastWorkspaceWidth        = 0;

    // Store a reference to the settings object.
    this._settings = ExtensionUtils.getSettings();
  }

  // ------------------------------------------------------------------------ public stuff

  // This function could be called after the extension is enabled, which could be done
  // from GNOME Tweaks, when you log in or when the screen is unlocked.
  enable() {

    // We will monkey-patch these three methods. Let's store the original ones.
    this._origUpdateWorkspacesState = WorkspacesView.prototype._updateWorkspacesState;
    this._origGetSpacing            = WorkspacesView.prototype._getSpacing;
    this._origUpdateVisibility      = WorkspacesView.prototype._updateVisibility;

    // We will use extensionThis to refer to the extension inside the patched methods of
    // the WorkspacesView.
    const extensionThis = this;

    // Normally, all workspaces outside the current field-of-view are hidden. We want to
    // show all workspaces, so we patch this method. The original code is about here:
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspacesView.js#L436
    WorkspacesView.prototype._updateVisibility = function() {
      this._workspaces.forEach((w) => {
        w.show();
      });
    };

    // Usually, workspaces are placed next to each other separated by a few pixels (this
    // separation is usually computed by the method below). To create the desktop cube, we
    // have to position all workspaces on top of each other and rotate the around a pivot
    // point in the center of the cube.
    // The original arrangement of the workspaces is implemented in WorkspacesView's
    // vfunc_allocate() which cannot be monkey-patched. As a workaround, we return a
    // negative spacing in the method below...
    // The original code is about here:
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspacesView.js#L219
    WorkspacesView.prototype._getSpacing = function(box, fitMode, vertical) {
      // We use the "normal" workspace spacing in desktop and app-grid mode.
      const origValue =
          extensionThis._origGetSpacing.apply(this, [box, fitMode, vertical]);

      if (fitMode == FitMode.ALL) {
        return origValue;
      }

      // Compute the negative spacing required to arrange workspaces on top of each other.
      const overlapValue = -this._workspaces[0].get_preferred_width(box.get_size()[1])[1];

      // Blend between the negative overlap-spacing and the "normal" spacing value.
      const cubeMode = extensionThis._getCubeMode(this);
      return Util.lerp(origValue, overlapValue, cubeMode);
    };

    // This is the main method which is called whenever the workspaces need to be
    // repositioned.
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspacesView.js#L255
    WorkspacesView.prototype._updateWorkspacesState = function() {
      // Use the original method if we have just one workspace.
      const faceCount = this._workspaces.length;
      if (faceCount <= 1) {
        extensionThis._origUpdateWorkspacesState.apply(this);
        return;
      }

      // First we need the width of a single workspace. Simply calling
      // this._workspaces[0]._background.width does not work in all cases, as this method
      // seems to be called also when the background actor is not on the stage. As a hacky
      // workaround, we store the last valid workspace width we got and use that value if
      // we cannot get a new one...
      let workspaceWidth = extensionThis._lastWorkspaceWidth;
      const bg           = this._workspaces[0]._background;
      if (bg.get_stage() && bg.allocation.get_width()) {
        workspaceWidth = bg.allocation.get_width();
        workspaceWidth += 2 * extensionThis._settings.get_int('workpace-separation');
        extensionThis._lastWorkspaceWidth = workspaceWidth;
      }

      // Usually, the "cube" covers full 360°.
      let fullAngle = 360;

      // That's the angle between consecutive workspaces.
      let faceAngle = fullAngle / faceCount;

      // With this setting, our "cube" only covers 180°, if there are only two workspaces,
      // it covers 90°. This prevents the affordance that it could be possible to switch
      if (extensionThis._settings.get_boolean('last-first-gap')) {
        fullAngle = (faceCount == 2 ? 90 : 180);
        faceAngle = fullAngle / (faceCount - 1);
      }

      // That's the z-distance from the cube faces to the rotation pivot.
      let centerDepth = workspaceWidth / 2;
      if (faceAngle < 180) {
        centerDepth /= Math.tan(faceAngle * 0.5 * Math.PI / 180);
      }

      // Compute blending state from and to the overview, from and to the app grid, and
      // from and to the desktop mode. We will use cubeMode to fold and unfold the
      // cube, overviewMode to add some depth between windows and backgrounds, and
      // appDrawerMode to attenuate the scaling effect of the active workspace.
      const appDrawerMode = extensionThis._getAppDrawerMode(this);
      const overviewMode  = extensionThis._getOverviewMode(this);
      const cubeMode      = extensionThis._getCubeMode(this);

      // Now loop through all workspace and compute the individual rotations.
      this._workspaces.forEach((w, index) => {
        // First update the corner radii. Corners are only rounded in overview.
        w.stateAdjustment.value = overviewMode;

        // Now update the rotation of the cube face. The rotation center is -centerDepth
        // units behind the front face.
        w.pivot_point_z = -centerDepth;

        // The rotation angle is transitioned proportional to overviewMode² to create the
        // proper impression of folding.
        w.rotation_angle_y =
            cubeMode * (-this._scrollAdjustment.value + index) * faceAngle;

        // Add some separation between background and windows (only in overview mode).
        let bgScale =
            (centerDepth - extensionThis._settings.get_int('depth-separation')) /
            centerDepth;
        bgScale = Util.lerp(1, Math.max(0.1, bgScale), overviewMode);

        w._background.pivot_point_z = -centerDepth;
        w._background.set_pivot_point(0.5, 0.5);
        w._background.scale_x = w._background.scale_y = w._background.scale_z = bgScale;

        // Distance to being the active workspace in [-1...0...1].
        const dist = Math.clamp(index - this._scrollAdjustment.value, -1, 1);

        // This moves next and previous workspaces a bit to the left and right. This
        // ensures that we can actually see them if we look at the cube from the front.
        // The value is set to zero if we have five or more workspaces.
        if (faceCount <= 4) {
          w.translation_x =
              dist * overviewMode * extensionThis._settings.get_int('horizontal-stretch');
        } else {
          w.translation_x = 0;
        }

        // Update opacity only in overview mode.
        const opacityA = extensionThis._settings.get_int('active-workpace-opacity');
        const opacityB = extensionThis._settings.get_int('inactive-workpace-opacity');
        const opacity  = Util.lerp(opacityA, opacityB, Math.abs(dist));
        w._background.set_opacity(Util.lerp(255, opacity, overviewMode));

        // Update workspace scale only in app grid mode.
        const scale = Util.lerp(1, INACTIVE_SCALE, Math.abs(dist) * appDrawerMode);
        w.set_scale(scale, scale);
      });

      // The remainder of this method cares about proper depth sorting. First, we sort the
      // workspaces so that they are drawn back-to-front. Thereafter, we ensure that for
      // front-facing workspaces the background is drawn behind the window previews. For
      // back-facing workspaces this order is swapped.

      // The depth-sorting of cube faces is quite simple, we create a copy of the
      // workspaces list and sort it by increasing rotation angle.
      const workspaces = this._workspaces.slice();
      workspaces.sort((a, b) => {
        return Math.abs(a.rotation_angle_y) - Math.abs(b.rotation_angle_y);
      });

      // Then sort the children actors accordingly.
      for (let i = 1; i < workspaces.length; i++) {
        const w = workspaces[i];
        w.get_parent().set_child_below_sibling(w, workspaces[i - 1]);
      }

      // Now we compute wether the individual cube faces are front-facing or back-facing.
      // This is surprisingly difficult ... can this be simplified? Here, we compute the
      // angle between the vectors (camera -> cube face) and (rotation center -> cube
      // face). If this is > 90° it's front-facing.

      // First, compute distance of virtual camera to the front workspaces plane.
      const camDist = Main.layoutManager.monitors[this._monitorIndex].height /
          (2 * Math.tan(global.stage.perspective.fovy / 2 * Math.PI / 180));

      // Then loop through all workspaces.
      for (let i = 0; i < this._workspaces.length; i++) {
        const w = this._workspaces[i];

        if (w.rotation_angle_y == 0) {

          // Special case: The workspace is directly in front of us.
          w.set_child_below_sibling(w._background, null);

        } else {

          // a is the length of vector from camera to rotation center.
          const a = camDist + centerDepth;

          // Enclosed angle between the a and b.
          const gamma = Math.abs(w.rotation_angle_y);

          // b is the length of vector from center of cube face to rotation center. This
          // would be only centerDepth if the sides of the cube were not spaced further
          // apart horizontally by the "horizontal-stretch". Computed with law of cosines:
          // b²=d²+s²-2ds*cos(90+gamma).
          const s = Math.abs(w.translation_x);
          const d = centerDepth;
          const b = Math.sqrt(
              d * d + s * s - 2 * d * s * Math.cos((90 + gamma) * Math.PI / 180));

          // Length of vector from virtual camera to center of the cube face. Computed
          // with law of cosines: c²=a²+b²-2ab*cos(gamma).
          const c =
              Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(gamma * Math.PI / 180));

          // Enclosed angle between vector from virtual camera to center of the cube face
          // and from center of cube face to rotation center. Computed with the Law of
          // cosines again: alpha=acos((b²+c²-a²)(2bc))
          const alpha = Math.acos((b * b + c * c - a * a) / (2 * b * c)) * 180 / Math.PI;

          // Draw the background actor first if it's a front-facing cube side. Draw it
          // last if it's a back-facing cube side.
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

    // Restore the original behavior.
    WorkspacesView.prototype._updateWorkspacesState = this._origUpdateWorkspacesState;
    WorkspacesView.prototype._getSpacing            = this._origGetSpacing;
    WorkspacesView.prototype._updateVisibility      = this._origUpdateVisibility;
  }

  // ----------------------------------------------------------------------- private stuff

  // Returns a value between [0...1] blending between overview (0) and app grid mode (1).
  _getAppDrawerMode(workspacesView) {
    return workspacesView._fitModeAdjustment.value;
  }

  // Returns a value between [0...1] blending between desktop / app drawer mode (0) and
  // overview mode (1).
  _getOverviewMode(workspacesView) {
    return workspacesView._overviewAdjustment.value -
        2 * this._getAppDrawerMode(workspacesView);
  }

  // Returns a value between [0...1]. If it's 0, the cube should be unfolded, if it's 1,
  // the cube should be drawn like, well, a cube :).
  _getCubeMode(workspacesView) {
    if (this._settings.get_boolean('unfold-to-desktop')) {
      return this._getOverviewMode(workspacesView);
    }

    return 1 - this._getAppDrawerMode(workspacesView)
  }
}

// This function is called once when the extension is loaded, not enabled.
function init() {
  return new Extension();
}
