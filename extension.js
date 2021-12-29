//////////////////////////////////////////////////////////////////////////////////////////
// ,-.  ,--.  ,-.  ,  , ,---.  ,-.  ;-.     ,-. .  . ,-.  ,--.       Copyright (c) 2021 //
// |  \ |    (   ` | /    |   /   \ |  )   /    |  | |  ) |            Simon Schneegans //
// |  | |-    `-.  |<     |   |   | |-'    |    |  | |-<  |-   Released under the GPLv3 //
// |  / |    .   ) | \    |   \   / |      \    |  | |  ) |       or later. See LICENSE //
// `-'  `--'  `-'  '  `   '    `-'  '       `-' `--` `-'  `--'        file for details. //
//////////////////////////////////////////////////////////////////////////////////////////

'use strict';

const Util             = imports.misc.util;
const Main             = imports.ui.main;
const OverviewControls = imports.ui.overviewControls;
const WorkspacesView   = imports.ui.workspacesView.WorkspacesView;
const FitMode          = imports.ui.workspacesView.FitMode;
const MonitorGroup     = imports.ui.workspaceAnimation.MonitorGroup;
const WorkspaceAnimationController =
    imports.ui.workspaceAnimation.WorkspaceAnimationController;

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
    this._lastWorkspaceWidth = 0;
  }

  // ------------------------------------------------------------------------ public stuff

  // This function could be called after the extension is enabled, which could be done
  // from GNOME Tweaks, when you log in or when the screen is unlocked.
  enable() {

    // Store a reference to the settings object.
    this._settings = ExtensionUtils.getSettings();

    // We will monkey-patch these three methods. Let's store the original ones.
    this._origUpdateWorkspacesState = WorkspacesView.prototype._updateWorkspacesState;
    this._origGetSpacing            = WorkspacesView.prototype._getSpacing;
    this._origUpdateVisibility      = WorkspacesView.prototype._updateVisibility;
    this._origMonitorGroupInit      = MonitorGroup.prototype._init;
    this._origAnimateSwitch = WorkspaceAnimationController.prototype.animateSwitch;
    this._origPrepSwitch = WorkspaceAnimationController.prototype._prepareWorkspaceSwitch;

    // We may also override these animation times.
    this._origWorkspaceSwitchTime = imports.ui.workspacesView.WORKSPACE_SWITCH_TIME;
    this._origToOverviewTime      = imports.ui.overview.ANIMATION_TIME;
    this._origToAppDrawerTime = imports.ui.overviewControls.SIDE_CONTROLS_ANIMATION_TIME;

    // We will use extensionThis to refer to the extension inside the patched methods of
    // the WorkspacesView.
    const extensionThis = this;

    // Connect the animation times to our settings.
    const loadAnimationTimes = () => {
      {
        const t = this._settings.get_int('overview-transition-time');
        imports.ui.overview.ANIMATION_TIME = (t > 0 ? t : this._origToOverviewTime);
      }
      {
        const t = this._settings.get_int('appgrid-transition-time');
        imports.ui.overviewControls.SIDE_CONTROLS_ANIMATION_TIME =
            (t > 0 ? t : this._origToAppDrawerTime);
      }
      {
        const t = this._settings.get_int('workspace-transition-time');
        imports.ui.workspacesView.WORKSPACE_SWITCH_TIME =
            (t > 0 ? t : this._origWorkspaceSwitchTime);
      }
    };

    this._settings.connect('changed::overview-transition-time', loadAnimationTimes);
    this._settings.connect('changed::appgrid-transition-time', loadAnimationTimes);
    this._settings.connect('changed::workspace-transition-time', loadAnimationTimes);

    loadAnimationTimes();

    // Here, we extend the WorkspaceAnimationController's animateSwitch method in order to
    // be able to modify the animation duration for switching workspaces in desktop mode.
    // We have to do it like this since the time is hard-coded with a constant:
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspaceAnimation.js#L11
    WorkspaceAnimationController.prototype.animateSwitch = function(...params) {
      // Call the original method. This sets up the progress transitions which we tweak
      // thereafter.
      extensionThis._origAnimateSwitch.apply(this, params);

      // We do not override this time if the cube is unfolded in desktop mode.
      if (extensionThis._settings.get_boolean('unfold-to-desktop')) {
        return;
      }

      // Now update the transition durations.
      const duration = extensionThis._settings.get_int('workspace-transition-time');
      for (const monitorGroup of this._switchData.monitors) {
        monitorGroup.get_transition('progress').set_duration(duration);
      }
    };

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

      // Compute blending state from and to the overview, from and to the app grid, and
      // from and to the desktop mode. We will use cubeMode to fold and unfold the
      // cube, overviewMode to add some depth between windows and backgrounds, and
      // appDrawerMode to attenuate the scaling effect of the active workspace.
      const appDrawerMode = extensionThis._getAppDrawerMode(this);
      const overviewMode  = extensionThis._getOverviewMode(this);
      const cubeMode      = extensionThis._getCubeMode(this);

      // First we need the width of a single workspace. Simply calling
      // this._workspaces[0]._background.width does not work in all cases, as this method
      // seems to be called also when the background actor is not on the stage. As a hacky
      // workaround, we store the last valid workspace width we got and use that value if
      // we cannot get a new one...
      let workspaceWidth = extensionThis._lastWorkspaceWidth;
      const bg           = this._workspaces[0]._background;
      if (bg.get_stage() && bg.allocation.get_width() > 0) {
        workspaceWidth = bg.allocation.get_width();

        // Add gaps between workspaces in overview mode.
        workspaceWidth +=
            overviewMode * 2 * extensionThis._settings.get_int('workpace-separation');

        extensionThis._lastWorkspaceWidth = workspaceWidth;
      }

      // That's the angle between consecutive workspaces.
      const faceAngle = extensionThis._getFaceAngle(faceCount);

      // That's the z-distance from the cube faces to the rotation pivot.
      const centerDepth = extensionThis._getCenterDist(workspaceWidth, faceAngle);

      // Now loop through all workspace and compute the individual rotations.
      this._workspaces.forEach((w, index) => {
        // First update the corner radii. Corners are only rounded in overview.
        w.stateAdjustment.value = overviewMode;

        // Now update the rotation of the cube face. The rotation center is -centerDepth
        // units behind the front face.
        w.pivot_point_z = -centerDepth;

        // The rotation angle is transitioned proportional to cubeMode^1.5. This slows
        // down the rotation a bit closer to the desktop and to the app drawer.
        w.rotation_angle_y =
            Math.pow(cubeMode, 1.5) * (-this._scrollAdjustment.value + index) * faceAngle;

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

      // The depth-sorting of cube faces is quite simple, we sort them by increasing
      // rotation angle.
      extensionThis._sortActorsByAngle(this._workspaces);

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

    // This lambda makes the transition between workspaces look like a rotating cube if
    // the unfold-to-desktop option is not set.
    const makeWorkspaceSwitchCuboid = () => {
      // Use original methods if the unfold-to-desktop option is set.
      if (this._settings.get_boolean('unfold-to-desktop')) {
        MonitorGroup.prototype._init = this._origMonitorGroupInit;
        WorkspaceAnimationController.prototype._prepareWorkspaceSwitch =
            this._origPrepSwitch;

      } else {

        // This override looks kind of funny. It simply calls the original method without
        // any arguments. Usually, GNOME Shell "skips" workspaces when switching to a
        // workspace which is more than one workspace to the left or the right. This
        // behavior is not desirable for thr cube, as it messes with your spatial memory.
        // If no workspaceIndices are given to this method, all workspaces will be shown
        // during the workspace switch.
        // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspaceAnimation.js#L300
        WorkspaceAnimationController.prototype._prepareWorkspaceSwitch = function() {
          extensionThis._origPrepSwitch.apply(this, []);
        };

        // This override rotates the workspaces during the transition to look like cube
        // faces. The original movement of the workspaces is implemented in the setter of
        // the progress property. We do not touch this, as keeping track of this progress
        // is rather important. Instead, we listen to position changes and tweak the
        // transformation accordingly.
        // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspaceAnimation.js#L135
        MonitorGroup.prototype._init = function(...params) {
          // Call the original constructor.
          extensionThis._origMonitorGroupInit.apply(this, params);

          // Rotate the faces if the progress changes.
          this.connect('notify::progress', () => {
            // First, we prevent any horizontal movement by countering the translation. We
            // cannot simply set the x property to zero as this is used to track the
            // progress.
            this._container.translation_x = -this._container.x;

            // That's the desired angle between consecutive workspaces.
            const faceAngle = extensionThis._getFaceAngle(this._workspaceGroups.length);

            // That's the z-distance from the cube faces to the rotation pivot.
            const centerDepth =
                extensionThis._getCenterDist(this._workspaceGroups[0].width, faceAngle);

            // Rotate the individual faces.
            this._workspaceGroups.forEach((child, i) => {
              child.set_pivot_point_z(-centerDepth);
              child.set_pivot_point(0.5, 0.5);
              child.rotation_angle_y = (i - this.progress) * faceAngle;

              // Counter any movement.
              child.translation_x = -child.x;
            });

            // The depth-sorting of cube faces is quite simple, we sort them by increasing
            // rotation angle.
            extensionThis._sortActorsByAngle(this._workspaceGroups);
          });
        };
      }
    };

    // The workspace-switch in desktop-mode (not in overview) looks like a cube only if
    // the unfold-to-desktop option is not set.
    this._settings.connect('changed::unfold-to-desktop', makeWorkspaceSwitchCuboid);
    makeWorkspaceSwitchCuboid();
  }

  // This function could be called after the extension is uninstalled, disabled in GNOME
  // Tweaks, when you log out or when the screen locks.
  disable() {

    // Restore the original behavior.
    WorkspacesView.prototype._updateWorkspacesState = this._origUpdateWorkspacesState;
    WorkspacesView.prototype._getSpacing            = this._origGetSpacing;
    WorkspacesView.prototype._updateVisibility      = this._origUpdateVisibility;
    MonitorGroup.prototype._init                    = this._origMonitorGroupInit;
    WorkspaceAnimationController.prototype.animateSwitch = this._origAnimateSwitch;
    WorkspaceAnimationController.prototype._prepareWorkspaceSwitch = this._origPrepSwitch;

    imports.ui.workspacesView.WORKSPACE_SWITCH_TIME = this._origWorkspaceSwitchTime;
    imports.ui.overview.ANIMATION_TIME              = this._origToOverviewTime;
    imports.ui.overviewControls.SIDE_CONTROLS_ANIMATION_TIME = this._origToAppDrawerTime;

    this._settings = null;
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

  // Returns the angle between consecutive workspaces.
  _getFaceAngle(faceCount) {

    // With this setting, our "cube" only covers 180°, if there are only two workspaces,
    // it covers 90°. This prevents the affordance that it could be possible to switch
    // from the last ot the first workspace.
    if (this._settings.get_boolean('last-first-gap')) {
      return (faceCount == 2 ? 90 : 180) / (faceCount - 1);
    }

    // Else the "cube" covers 360°.
    return 360.0 / faceCount;
  }

  // Returns the z-distance from the cube faces to the rotation pivot.
  _getCenterDist(workspaceWidth, faceAngle) {
    let centerDepth = workspaceWidth / 2;
    if (faceAngle < 180) {
      centerDepth /= Math.tan(faceAngle * 0.5 * Math.PI / 180);
    }
    return centerDepth;
  }

  // This sorts the given list of children actors (which are supposed to be attached to
  // the same parent) by increasing rotation-y angle. This is used for depth-sorting, as
  // cube faces which are less rotated, are in front of others.
  _sortActorsByAngle(actors) {
    // First create a copy of the actors list and sort it by decreasing rotation angle.
    const copy = actors.slice();
    copy.sort((a, b) => {
      return Math.abs(b.rotation_angle_y) - Math.abs(a.rotation_angle_y);
    });

    // Then sort the children actors accordingly.
    const parent = actors[0].get_parent();
    for (let i = 0; i < copy.length; i++) {
      parent.set_child_at_index(copy[i], -1);
    }
  }
}

// This function is called once when the extension is loaded, not enabled.
function init() {
  return new Extension();
}
