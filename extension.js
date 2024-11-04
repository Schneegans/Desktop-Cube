//////////////////////////////////////////////////////////////////////////////////////////
//             ,-.  ,--.  ,-.  ,  , ,---.  ,-.  ;-.     ,-. .  . ,-.  ,--.              //
//             |  \ |    (   ` | /    |   /   \ |  )   /    |  | |  ) |                 //
//             |  | |-    `-.  |<     |   |   | |-'    |    |  | |-<  |-                //
//             |  / |    .   ) | \    |   \   / |      \    |  | |  ) |                 //
//             `-'  `--'  `-'  '  `   '    `-'  '       `-' `--` `-'  `--'              //
//////////////////////////////////////////////////////////////////////////////////////////

// SPDX-FileCopyrightText: Simon Schneegans <code@simonschneegans.de>
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import GOpenHMD from 'gi://GOpenHMD';
import Gxr from 'gi://Gxr';

import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import {PressureBarrier} from 'resource:///org/gnome/shell/ui/layout.js';
import {WorkspacesView, FitMode} from 'resource:///org/gnome/shell/ui/workspacesView.js';
import {SwipeTracker} from 'resource:///org/gnome/shell/ui/swipeTracker.js';
import {WorkspaceAnimationController} from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import {WorkspaceGroup, MonitorGroup} from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as utils from './src/utils.js';
import {setInterval, clearInterval} from './src/utils.js';
import {DragGesture} from './src/DragGesture.js';
import {Skybox} from './src/Skybox.js';
import {CorsorBeam} from './src/shaders.js';

//////////////////////////////////////////////////////////////////////////////////////////
// This extensions tweaks the positioning of workspaces in overview mode and while      //
// switching workspaces in desktop mode to make them look like cube faces.              //
//////////////////////////////////////////////////////////////////////////////////////////

const [GS_VERSION] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));

// Maximum degrees the cube can be rotated up and down.
const MAX_VERTICAL_ROTATION = 50;

// Spacing to the screen sides of the vertically rotated cube.
const PADDING_V_ROTATION = 0.2;

export default class DesktopCube extends Extension {
  _lastWorkspaceWidth = 0;

  // ------------------------------------------------------------------------ public stuff

  // This function could be called after the extension is enabled, which could be done
  // from GNOME Tweaks, when you log in or when the screen is unlocked.
  enable() {

    // Store a reference to the settings object.
    this._settings = this.getSettings();

    // We will monkey-patch these methods. Let's store the original ones.
    this._origEndGesture            = SwipeTracker.prototype._endGesture;
    this._origUpdateWorkspacesState = WorkspacesView.prototype._updateWorkspacesState;
    this._origGetSpacing            = WorkspacesView.prototype._getSpacing;
    this._origUpdateVisibility      = WorkspacesView.prototype._updateVisibility;
    this._origOnScrollAdjustmentChanged = WorkspacesView.prototype._onScrollAdjustmentChanged
    this._origPrepSwitch = WorkspaceAnimationController.prototype._prepareWorkspaceSwitch;
    this._origFinalSwitch = WorkspaceAnimationController.prototype._finishWorkspaceSwitch;
    this._origWorkspaceGroupInit = WorkspaceGroup.prototype._init;
    this._origWorkspaceGroupCreateClone = WorkspaceGroup.prototype._createClone;

    // We will use extensionThis to refer to the extension inside the patched methods.
    var extensionThis = this;

    // -----------------------------------------------------------------------------------
    // ------------------------------- cubify the overview -------------------------------
    // -----------------------------------------------------------------------------------

    // Normally, all workspaces outside the current field-of-view are hidden. We want to
    // show all workspaces, so we patch this method. The original code is about here:
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspacesView.js#L420
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
      if (extensionThis._settings.get_boolean('enable-vr')) {
        if (extensionThis.workspacesView !== this) {
          extensionThis.workspacesView = this;
        }
      }

      // Use the original method if we have just one workspace.
      const faceCount = this._workspaces.length;
      if (faceCount <= 1) {
        extensionThis._origUpdateWorkspacesState.apply(this);
        return;
      }

      // Here's a minor hack to improve the performance: During the transitions to / from
      // the app drawer, this._updateWorkspacesState is called twice a frame. Once from
      // the notify handler of this._fitModeAdjustment and thereafter once from the notify
      // handler of this._overviewAdjustment. As this seems not so useful (and degrades
      // performance a lot), we skip the first call. I am not aware of any cases where
      // this._fitModeAdjustment is changed without any of the over adjustments to change
      // as well...
      // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspacesView.js#L109
      // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspacesView.js#L45
      if ((new Error()).stack.includes('fitModeNotify')) {
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

      // Apply vertical rotation if required. This comes from the pitch value of the
      // modified SwipeTracker created by _addOverviewDragGesture() further below.
      if (extensionThis._settings.get_boolean('enable-vr')) {
        // The centre of rotation should be in the user position
        // TODO: probably better to set to a Clutter Stage's zfar value.
        this.pivot_point_z = centerDepth;
      } else {
        this.pivot_point_z = -centerDepth;
      }

      this.set_pivot_point(0.5, 0.5);

      if (extensionThis._settings.get_boolean('enable-vr')) {
        this.rotation_angle_x = extensionThis.rot_x;
      } else {
        this.rotation_angle_x = extensionThis._pitch.value * MAX_VERTICAL_ROTATION;
      }

      // During rotations, the cube is scaled down and the windows are "exploded". If we
      // are directly facing a cube side, the strengths of both effects are approaching
      // zero. The strengths of both effects are small during horizontal rotations to make
      // workspace-switching not so obtrusive. However, during vertical rotations, the
      // effects are stronger.
      const [depthOffset, explode] = extensionThis._getExplodeFactors(
        this._scrollAdjustment.value, extensionThis._pitch.value, centerDepth,
        this._monitorIndex);

      // Now loop through all workspace and compute the individual rotations.
      this._workspaces.forEach((w, index) => {
        // First update the corner radii. Corners are only rounded in overview.
        w.stateAdjustment.value = overviewMode;

        // Now update the rotation of the cube face.
        if (extensionThis._settings.get_boolean('enable-vr')) {
          // The centre of rotation should be in the user position
          // TODO: probably better to set to a Clutter Stage's zfar value.
          w.pivot_point_z = centerDepth;
        } else {
          // The rotation center is -centerDepth
          // units behind the front face.
          w.pivot_point_z = -centerDepth;
        }

        // Make cube smaller during rotations.
        if (extensionThis._settings.get_boolean('enable-vr')) {
          // w.translation_z = -depthOffset;
        } else {
          w.translation_z = -depthOffset;
        }

        if (extensionThis._settings.get_boolean('enable-vr')) {
          w.rotation_angle_y = -1 * (-this._scrollAdjustment.value + index) * faceAngle -
            extensionThis.rot_y;
        } else {
          // The rotation angle is transitioned proportional to cubeMode^1.5. This slows
          // down the rotation a bit closer to the desktop and to the app drawer.
          w.rotation_angle_y =
            Math.pow(cubeMode, 1.5) * (-this._scrollAdjustment.value + index) * faceAngle;
        }

        // Distance to being the active workspace in [-1...0...1].
        const dist = Math.clamp(index - this._scrollAdjustment.value, -1, 1);

        // This moves next and previous workspaces a bit to the left and right. This
        // ensures that we can actually see them if we look at the cube from the front.
        // The value is set to zero if we have five or more workspaces.
        if (extensionThis._settings.get_boolean('enable-vr')) {
        } else {
          if (faceCount <= 4) {
            w.translation_x =
              dist * overviewMode * extensionThis._settings.get_int('horizontal-stretch');
          } else {
            w.translation_x = 0;
          }
        }

        // Update opacity only in overview mode.
        const opacityA = extensionThis._settings.get_int('active-workpace-opacity');
        const opacityB = extensionThis._settings.get_int('inactive-workpace-opacity');
        const opacity  = Util.lerp(opacityA, opacityB, Math.abs(dist));
        w._background.set_opacity(Util.lerp(255, opacity, overviewMode));

        // Update workspace scale only in app grid mode. The 0.94 is supposed to be the
        // same value as the WORKSPACE_INACTIVE_SCALE defined here:
        // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspacesView.js#L21
        // As this is defined as 'const', we cannot access it here. But the exact value
        // also not really matters...
        const scale = Util.lerp(1, 0.94, Math.abs(dist) * appDrawerMode);
        w.set_scale(scale, scale);

        // Now we add some depth separation between the window clones. If the explode
        // factor becomes too small, the depth sorting becomes non-deterministic.
        if (explode > 0.001) {

          const sortedActors = w._container.layout_manager._sortedWindows;

          // Distribute the window clones translation_z values between zero and
          // explode.
          sortedActors.forEach((windowActor, j) => {
            windowActor.translation_z = explode * (j + 1) / sortedActors.length;
          });

          // Now sort the window clones according to the orthogonal distance of the actor
          // planes to the camera. This ensures proper depth sorting among the window
          // clones.
          if (sortedActors.length > 1) {
            extensionThis._depthSortWindowActors(w._container.get_children(),
                                                 this._monitorIndex);
          }
        }

        // Now we sort the children of the workspace (e.g. the background actor
        // and the container for the window clones) by their orthogonal distance to the
        // virtual camera. We add a tiny translation to the window-clone container to
        // allow for proper sorting.
        w._container.translation_z = 1;
        extensionThis._depthSortWindowActors(w.get_children(), this._monitorIndex);
      });

      // The depth-sorting of cube faces is quite simple, we sort them by increasing
      // rotation angle so that they are drawn back-to-front.
      extensionThis._depthSortCubeFaces(this._workspaces);
    };

    // Just get our own scrollAdjustment
    WorkspacesView.prototype._onScrollAdjustmentChanged = function() {
      if (!extensionThis._scrollAdjustment) {
        extensionThis._scrollAdjustment = this._scrollAdjustment;
      }
      extensionThis._origOnScrollAdjustmentChanged.apply(this);
    }


    // -----------------------------------------------------------------------------------
    // --------------------- cubify workspace-switch in desktop mode ---------------------
    // -----------------------------------------------------------------------------------

    // This override rotates the workspaces during the transition to look like cube
    // faces. The original movement of the workspaces is implemented in the setter of
    // the progress property. We do not touch this, as keeping track of this progress
    // is rather important. Instead, we listen to progress changes and tweak the
    // transformation accordingly.
    // This lambda is called in two places (further down), once for updates of the
    // progress property, once for updates during gesture swipes. The latter does not
    // trigger notify signals of the former for some reason...
    const updateMonitorGroup = (group) => {
      // First, we prevent any horizontal movement by countering the translation. We
      // cannot simply set the x property to zero as this is used to track the
      // progress.
      group._container.translation_x = -group._container.x;

      // That's the desired angle between consecutive workspaces.
      const faceAngle = extensionThis._getFaceAngle(group._workspaceGroups.length);

      // That's the z-distance from the cube faces to the rotation pivot.
      const centerDepth =
        extensionThis._getCenterDist(group._workspaceGroups[0].width, faceAngle);

      // Apply vertical rotation if required. This comes from the pitch value of the
      // modified SwipeTracker created by _addDesktopDragGesture() further below.
      if (extensionThis._settings.get_boolean('enable-vr')) {
        // The centre of rotation should be in the user position
        // TODO: probably better to set to a Clutter Stage's zfar value.
        group._container.pivot_point_z = centerDepth;
      } else {
        group._container.pivot_point_z = -centerDepth;
      }
      group._container.set_pivot_point(0.5, 0.5);

      if (extensionThis._settings.get_boolean('enable-vr')) {
        group._container.rotation_angle_x =
          -extensionThis._pitch.value * MAX_VERTICAL_ROTATION + extensionThis.rot_x;
      } else {
        group._container.rotation_angle_x =
          extensionThis._pitch.value * MAX_VERTICAL_ROTATION;
      }

      // During rotations, the cube is scaled down and the windows are "exploded". If we
      // are directly facing a cube side, the strengths of both effects are approaching
      // zero. The strengths of both effects are small during horizontal rotations to make
      // workspace-switching not so obtrusive. However, during vertical rotations, the
      // effects are stronger.
      // if (extensionThis._settings.get_boolean('enable-vr')) {
      //   const [depthOffset, explode] = extensionThis._getExplodeFactors(
      //     group.progress, extensionThis._pitch.value + extensionThis.rot_x,
      //     centerDepth, group._monitor.index);
      // } else {
      const [depthOffset, explode] = extensionThis._getExplodeFactors(
        group.progress, extensionThis._pitch.value, centerDepth, group._monitor.index);
      // }

      // Rotate the individual faces.
      group._workspaceGroups.forEach((child, i) => {
        if (extensionThis._settings.get_boolean('enable-vr')) {
          // The centre of rotation should be in the user position
          // TODO: probably better to set to a Clutter Stage's zfar value.
          child.set_pivot_point_z(centerDepth);
        } else {
          child.set_pivot_point_z(-centerDepth);
        }
        child.set_pivot_point(0.5, 0.5);
        if (extensionThis._settings.get_boolean('enable-vr')) {
          const scroll = extensionThis._scrollAdjustment ? extensionThis._scrollAdjustment.value : 0;
          child.rotation_angle_y =
            -1 * (i - group.progress - scroll) * faceAngle - extensionThis.rot_y;
          child.translation_z = -depthOffset;
        } else {
          child.rotation_angle_y = (i - group.progress) * faceAngle;
          child.translation_z    = -depthOffset;
        }
        child.clip_to_allocation = false;

        // Counter the horizontal movement.
        child.translation_x = -child.x;

        // Make cube transparent during vertical rotations.
        if (extensionThis._settings.get_boolean('enable-vr')) {
          // child._background.opacity =
          //   255 * (1.0 - Math.abs(extensionThis._pitch.value + extensionThis.rot_x));
        } else {
          child._background.opacity = 255 * (1.0 - Math.abs(extensionThis._pitch.value));
        }

        // Now we add some depth separation between the window clones. We get the stacking
        // order from the global window list. If the explode factor becomes too small, the
        // depth sorting becomes non-deterministic.
        if (explode > 0.001) {
          const windowActors = global.get_window_actors().filter(w => {
            return child._shouldShowWindow(w.meta_window);
          });

          // Distribute the window clones translation_z values between zero and
          // explode.
          windowActors.forEach((windowActor, j) => {
            const record = child._windowRecords.find(r => r.windowActor === windowActor);
            if (record) {
              record.clone.translation_z = explode * (j + 1) / windowActors.length;
            }
          });

          // Now sort the window clones and the background actor according to the
          // orthogonal distance of the actor planes to the camera. This ensures proper
          // depth sorting.
          extensionThis._depthSortWindowActors(child.get_children(),
                                               group._monitor.index);
        }
      });

      // The depth-sorting of cube faces is quite simple, we sort them by increasing
      // rotation angle.
      extensionThis._depthSortCubeFaces(group._workspaceGroups);

      // Update horizontal rotation of the background panorama during workspace switches.
      if (this._skybox) {
        if (extensionThis._settings.get_boolean('enable-vr')) {
          this._skybox.yaw = -1 * 2 * Math.PI * group.progress /
            global.workspaceManager.get_n_workspaces();
        } else {
          this._skybox.yaw =
            2 * Math.PI * group.progress / global.workspaceManager.get_n_workspaces();
        }
      }
    };

    // Whenever a workspace-switch is about to happen, we tweak the MonitorGroup class a
    // bit to arrange the workspaces in a cube-like fashion. We have to adjust to parts of
    // the code as the automatic transitions (e.g. when switching with key combinations)
    // are handled differently than the gesture based switches.
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspaceAnimation.js#L299
    WorkspaceAnimationController.prototype._prepareWorkspaceSwitch = function() {
      // Here, we call the original method without any arguments. Usually, GNOME Shell
      // "skips" workspaces when switching to a workspace which is more than one workspace
      // to the left or the right. This behavior is not desirable for thr cube, as it
      // messes with your spatial memory. If no workspaceIndices are given to this method,
      // all workspaces will be shown during the workspace switch.
      extensionThis._origPrepSwitch.apply(this, []);

      // Save switchData with monitors for calling updateMonitorGroup() outside of this
      // function
      try {
        if (this._switchData != extensionThis.switchData) {
          extensionThis.switchData = this._switchData;
        }
      } catch {
      }

      // Now tweak the monitor groups.
      this._switchData.monitors.forEach(m => {
        // Call the method above whenever the transition progress changes.
        m.connect('notify::progress', () => updateMonitorGroup(m));

        // Call the method above whenever a gesture is active.
        const orig              = m.updateSwipeForMonitor;
        m.updateSwipeForMonitor = function(progress, baseMonitorGroup) {
          orig.apply(m, [progress, baseMonitorGroup]);
          updateMonitorGroup(m);
        };
      });

      // Make sure that the background panorama is drawn above the window group during a
      // workspace switch.
      if (extensionThis._skybox) {
        extensionThis._skybox.get_parent().remove_child(extensionThis._skybox);
        Main.uiGroup.insert_child_above(extensionThis._skybox, global.window_group);

        // If the workspaces are only on the primary monitor, the skybox would cover all
        // other non-rotating screens. Therefore, we temporarily limit its size to the
        // primary monitor's size.
        if (Meta.prefs_get_workspaces_only_on_primary()) {
          const monitor =
            global.display.get_monitor_geometry(global.display.get_primary_monitor());
          extensionThis._skybox.width  = monitor.width;
          extensionThis._skybox.height = monitor.height;
          extensionThis._skybox.x      = monitor.x;
          extensionThis._skybox.y      = monitor.y;
        }
      }
    };

    // Re-attach the background panorama to the stage once the workspace switch is done.
    WorkspaceAnimationController.prototype._finishWorkspaceSwitch = function(...params) {
      // if (extensionThis._settings.get_boolean('enable-vr')) {
        // Meta.enable_unredirect_for_display(global.display);

        // It is used by main HMD update cycle too
        // Also, for some reason, commenting it out is preventing view repositioning to
        // the centre after a gesture end
        // this._switchData = null;
        // switchData.monitors.forEach(m => m.destroy());

        // this.movingWindow = null;

      // } else {
        extensionThis._origFinalSwitch.apply(this, params);
      // }

      // Make sure that the skybox covers the entire stage again.
      if (extensionThis._skybox) {
        extensionThis._skybox.get_parent().remove_child(extensionThis._skybox);
        global.stage.insert_child_below(extensionThis._skybox, null);

        if (Meta.prefs_get_workspaces_only_on_primary()) {
          extensionThis._skybox.width  = global.stage.width;
          extensionThis._skybox.height = global.stage.height;
          extensionThis._skybox.x      = global.stage.x;
          extensionThis._skybox.y      = global.stage.y;
        }
      }
    };

    // Init function copied from `gnome-shell/js/ui/workspaceAnimation.js`
    // git version `3a34c16eca56bfa364d3415e777e309317de3c83`
    WorkspaceGroup.prototype._init = function (workspace, monitor, movingWindow) {
      // Clutter.Actor.prototype._init.call
      Object.getPrototypeOf(Object.getPrototypeOf(this))._init.call(this,{
        width: monitor.width,
        height: monitor.height,
        clip_to_allocation: true,
      });

      console.warn(`Creating WorkspaceGroup for workspace '${workspace}' and monitor '${monitor}'`);

      this._workspace = workspace;
      this._monitor = monitor;
      this._movingWindow = movingWindow;
      this._windowRecords = [];

      if (this._workspace) {
        this._background = new Meta.BackgroundGroup();

        this.add_child(this._background);

        this._bgManager = new Background.BackgroundManager({
          container: this._background,
          monitorIndex: this._monitor.index,
          controlPosition: false,
        });
        this._createDesktopWindows();
      }

      this._createWindows();

      this.connect('destroy', this._onDestroy.bind(this));
      global.display.connectObject('restacked',
        this._syncStacking.bind(this), this);

      //
      // START: Cube Desktop extension's patch 
      //
      // global.display.connect('window-created', (
      //   display, meta_window
      // ) => {
      //   console.warn(`Window '${meta_window}' is coming to the display '${display}'...`)

      //   console.warn(`Find actors that are matched to the provided meta_window ${meta_window}...`)
      //   const windowActors = global.get_window_actors().filter(w => {
      //     console.debug(`Check: ${w.meta_window} === ${meta_window}`);
      //     let match = (w.meta_window === meta_window);
      //     if (match) {
      //       console.warn(`Found the maching meta window '${meta_window}'`);
      //     }
      //     return match;
      //   });

      //   windowActors.forEach(actor => {
      //     let clone = this._createClone(actor);
      //     console.debug(`created clone ${clone} for window ${actor}`);

      //     // this._createDesktopWindows();
      //     if (this._workspace) {
      //       if (this._isDesktopWindow(meta_window) && this._windowIsOnThisMonitor(meta_window)) {
      //         this._background.add_child(clone);
      //       }
      //     }

      //     // this._createWindows();
      //     if (this._shouldShowWindow(meta_window)) {
      //       this.add_child(clone);
      //     }
      //   })

      //   console.warn(`'${windowActors.length}' actors was cloned on 'window-created' event on the display '${display}'`);
      // })


      if (this._workspace) {
        this._workspace.connect('window_added', (
          workspace,
          meta_window,
          user_data
        ) => {
          // TODO: Remove delay
          // The reason of this delay is due to new window sometimes didn't create.
          // Probably, it happens because of the event from Meta that is sometimes
          // coming earlier than Clutter gets the related actor.
          // Another variant to get the lost window back on the workspace is
          // to move the window's preview to another workspace.
          // The delay is quite a bad thing, but it is left here while
          // the stage of VR feature is a prototype and until the approach
          // of overcoming the issue would be found.
          setTimeout(() => {
            console.warn(`Window '${meta_window}' is coming to the workspace '${workspace}'...`)

            const clonedMetaWindows = this._windowRecords.map(record => {
              return record.windowActor.meta_window;
            });
  
            if (clonedMetaWindows.includes(meta_window)) {
              console.warn(`Window '${meta_window}' already was cloned, so skip cloning again`)
              return;
            }
  
            console.warn(`Find actors that are matched to the provided meta_window ${meta_window}...`)
            const actors = global.get_window_actors().filter(w => {
              console.warn(`Check '${w.meta_window}' === '${meta_window}'...`);
              let match = (w.meta_window === meta_window);
              if (match) {
                console.warn(`Found the maching meta window '${meta_window}'`);
                return match;
              }
            });
  
            actors.forEach(actor => {
              let clone = this._createClone(actor);
              if (this._isDesktopWindow(actor.meta_window) && this._windowIsOnThisMonitor(actor.meta_window)) {
                this._background.add_child(clone);
              }
              if (this._shouldShowWindow(actor.meta_window)) {
                this.add_child(clone);
              }
            });
  
            console.warn(`'${actors.length}' actors was cloned on 'window_added' event on the workspace '${workspace}'`);
          }, 100);
        });

        this._workspace.connect('window_removed', (
          workspace,
          meta_window,
          user_data
        ) => {
          console.warn(`Window '${meta_window}' is going away from the workspace '${workspace}'...`)

          const clonedMetaWindows = this._windowRecords.map(record => {
            return record.windowActor.meta_window;
          });

          if (!clonedMetaWindows.includes(meta_window)) {
            console.warn(`Window '${meta_window}' was not cloned, so skip removing it`)
            return;
          }

          console.warn(`Find records of cloned actors that are matched to the provided meta_window ${meta_window}...`)
          const cloneRecords = this._windowRecords.filter(record => {
            console.warn(`Check: '${record.windowActor.meta_window}' === '${meta_window}'`);
            let match = (record.windowActor.meta_window === meta_window);
            if (match) {
              console.warn(`Found the maching meta window '${meta_window}'`);
              return record;
            }
          });

          cloneRecords.forEach(record => {
            if (this._isDesktopWindow(record.windowActor.meta_window) && this._windowIsOnThisMonitor(record.windowActor.meta_window)) {
              this._background.remove_child(record.clone);
            }
            if (this._shouldShowWindow(record.windowActor.meta_window)) {
              this.remove_child(record.clone);
            }
            record.clone.destroy();
            this._windowRecords.pop(record);
          });

          console.warn(`'${cloneRecords.length}' records of actor clones was removed on 'window_removed' event from the workspace '${workspace}'`);

        });
      };

      //
      // END: Cube Desktop extension's patch 
      //

    }

    // Create clone function copied from `gnome-shell/js/ui/workspaceAnimation.js`
    // git version `3a34c16eca56bfa364d3415e777e309317de3c83`
    WorkspaceGroup.prototype._createClone = function (windowActor) {
      const clone = new Clutter.Clone({
        source: windowActor,
        x: windowActor.x - this._monitor.x,
        y: windowActor.y - this._monitor.y,
      });

      //
      // START: Cube Desktop extension's patch 
      //

      const notify_x_handler_id = windowActor.connect('notify::x', () => {
        clone.x = windowActor.x - this._monitor.x;
      });

      const notify_y_handler_id = windowActor.connect('notify::y', () => {
        clone.y = windowActor.y - this._monitor.x;
      });

      clone.connect('destroy', () => {
        windowActor.disconnect(notify_x_handler_id);
        windowActor.disconnect(notify_y_handler_id);
      });

      //
      // END: Cube Desktop extension's patch 
      //

      const record = { windowActor, clone };

      windowActor.connectObject('destroy', () => {
        clone.destroy();
        this._windowRecords.splice(this._windowRecords.indexOf(record), 1);
      }, this);

      this._windowRecords.push(record);
      return clone;
    }

    // -----------------------------------------------------------------------------------
    // ------------------------- enable cube rotation by dragging ------------------------
    // -----------------------------------------------------------------------------------

    // Usually, in GNOME Shell 40+, workspaces are move horizontally. We tweaked this to
    // look like a horizontal rotation above. To store the current vertical rotation, we
    // use the adjustment below.
    this._pitch = new St.Adjustment({actor: global.stage, lower: -1, upper: 1});

    // The overview's SwipeTracker will control the _overviewAdjustment of the
    // WorkspacesDisplay. However, only horizontal swipes will update this adjustment. If
    // only our pitch adjustment is changed (e.g. the user moved the mouse only
    // vertically), the _overviewAdjustment will not change and therefore the workspaces
    // will not been redrawn. Here we force redrawing by notifying changes if the pitch
    // value changes.
    this._pitch.connect('notify::value', () => {
      if (Main.actionMode == Shell.ActionMode.OVERVIEW) {
        Main.overview._overview._controls._workspacesDisplay._overviewAdjustment.notify(
          'value');
      }
    });

    // In GNOME Shell, SwipeTrackers are used all over the place to capture swipe
    // gestures. There's one for entering the overview, one for switching workspaces in
    // desktop mode, one for switching workspaces in overview mode, one for horizontal
    // scrolling in the app drawer, and many more. The ones used for workspace-switching
    // usually do not respond to single-click dragging but only to multi-touch gestures.
    // We want to be able to rotate the cube with the left mouse button, so we add an
    // additional gesture to these two SwipeTracker instances tracking single-click drags.

    // First, we fix an issue which leads to very quick workspace switches when the
    // SwipeTracker are used with mouse clicks. When the mouse button is released, no
    // event is added to the history. This means that the velocity is always calculated
    // relative to the last received mouse movement. Even if he mouse pointer was
    // stationary for some time, high velocities will be computed.
    SwipeTracker.prototype._endGesture = function(time, distance, isTouchpad) {
      // Add a final time step to the history.
      this._history.append(time, 0);

      // Then call the original method.
      extensionThis._origEndGesture.apply(this, [time, distance, isTouchpad]);
    };

    // Add single-click drag gesture to the desktop.
    if (this._settings.get_boolean('enable-desktop-dragging')) {
      this._addDesktopDragGesture();
    }

    this._settings.connect('changed::enable-desktop-dragging', () => {
      if (this._settings.get_boolean('enable-desktop-dragging')) {
        this._addDesktopDragGesture();
      } else {
        this._removeDesktopDragGesture();
      }
    });

    // Add single-click drag gesture to the panel.
    if (this._settings.get_boolean('enable-panel-dragging')) {
      this._addPanelDragGesture();
    }

    this._settings.connect('changed::enable-panel-dragging', () => {
      if (this._settings.get_boolean('enable-panel-dragging')) {
        this._addPanelDragGesture();
      } else {
        this._removePanelDragGesture();
      }
    });

    // Add single-click drag gesture to the overview.
    if (this._settings.get_boolean('enable-overview-dragging')) {
      this._addOverviewDragGesture();
    }

    this._settings.connect('changed::enable-overview-dragging', () => {
      if (this._settings.get_boolean('enable-overview-dragging')) {
        this._addOverviewDragGesture();
      } else {
        this._removeOverviewDragGesture();
      }
    });


    // -----------------------------------------------------------------------------------
    // ---------------------------------- add the skybox ---------------------------------
    // -----------------------------------------------------------------------------------

    // This is called whenever the skybox texture setting is changed.
    const updateSkybox = () => {
      // First, delete the existing skybox.
      if (this._skybox) {
        this._skybox.destroy();
        delete this._skybox;
      }

      const file = this._settings.get_string('background-panorama');

      // Then, load a new one (if any).
      if (file != '') {
        try {
          this._skybox = new Skybox(file);

          // We add the skybox below everything.
          global.stage.insert_child_below(this._skybox, null);

          // Make sure that the skybox covers the entire stage.
          global.stage.bind_property('width', this._skybox, 'width',
                                     GObject.BindingFlags.SYNC_CREATE);
          global.stage.bind_property('height', this._skybox, 'height',
                                     GObject.BindingFlags.SYNC_CREATE);

        } catch (error) {
          utils.debug('Failed to set skybox: ' + error);
        }
      }
    };

    // Update the skybox whenever the corresponding setting is changed.
    this._settings.connect('changed::background-panorama', updateSkybox);
    updateSkybox();

    // Update vertical rotation of the background panorama.
    if (this._settings.get_boolean('enable-vr')) {
    } else {
      this._pitch.connect('notify::value', () => {
        if (this._skybox) {
          this._skybox.pitch =
            (this._pitch.value * MAX_VERTICAL_ROTATION) * Math.PI / 180;
        }
      });
    }

    // Update horizontal rotation of the background panorama during workspace switches in
    // the overview.
    Main.overview._overview.controls._workspaceAdjustment.connect('notify::value', () => {
      if (this._skybox) {
        if (this._settings.get_boolean('enable-vr')) {
          this._skybox.yaw = -1 * 2 * Math.PI *
            Main.overview._overview.controls._workspaceAdjustment.value /
            global.workspaceManager.get_n_workspaces();
        } else {
          this._skybox.yaw = 2 * Math.PI *
            Main.overview._overview.controls._workspaceAdjustment.value /
            global.workspaceManager.get_n_workspaces();
        }
      }
    });


    // -----------------------------------------------------------------------------------
    // ----------------------- enable edge-drag workspace-switches -----------------------
    // -----------------------------------------------------------------------------------

    // We add two Meta.Barriers, one at each side of the stage. If the pointer hits one of
    // these with enough pressure while dragging a window, we initiate a workspace-switch.
    // The last parameter (0) is actually supposed to be a bitwise combination of
    // Shell.ActionModes. The pressure barrier will only trigger, if Main.actionMode
    // equals one of the given action modes. This works well for Shell.ActionMode.NORMAL
    // and Shell.ActionMode.OVERVIEW, however it does not work for Shell.ActionMode.NONE
    // (which actually equals zero). However, when we want the barriers to also trigger in
    // Shell.ActionMode.NONE, as this is the mode during a drag-operation in the overview.
    // Therefore, we modify the _onBarrierHit method of the pressure barrier to completely
    // ignore this parameter. Instead, we check for the correct action mode in the trigger
    // handler.
    this._pressureBarrier =
      new PressureBarrier(this._settings.get_int('edge-switch-pressure'), 1000, 0);

    // Update pressure threshold when the corresponding settings key changes.
    this._settings.connect('changed::edge-switch-pressure', () => {
      this._pressureBarrier._threshold = this._settings.get_int('edge-switch-pressure');
    });

    // This is an exact copy of the original _onBarrierHit, with only one line disabled to
    // ignore the given ActionMode.
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/layout.js#L1411
    this._pressureBarrier._onBarrierHit = function(barrier, event) {
      barrier._isHit = true;

      // If we've triggered the barrier, wait until the pointer has the
      // left the barrier hitbox until we trigger it again.
      if (this._isTriggered) return;

      if (this._eventFilter && this._eventFilter(event)) return;

      // Throw out all events not in the proper keybinding mode
      // if (!(this._actionMode & Main.actionMode)) return;

      let slide    = this._getDistanceAlongBarrier(barrier, event);
      let distance = this._getDistanceAcrossBarrier(barrier, event);

      if (distance >= this._threshold) {
        this._trigger();
        return;
      }

      // Throw out events where the cursor is move more
      // along the axis of the barrier than moving with
      // the barrier.
      if (slide > distance) return;

      this._lastTime = event.time;

      this._trimBarrierEvents();
      distance = Math.min(15, distance);

      this._barrierEvents.push([event.time, distance]);
      this._currentPressure += distance;

      if (this._currentPressure >= this._threshold) this._trigger();
    };

    // Now we add the left and right barrier to the pressure barrier.
    const createBarriers = () => {
      if (this._leftBarrier) {
        this._pressureBarrier.removeBarrier(this._leftBarrier);
        this._leftBarrier.destroy();
      }

      if (this._rightBarrier) {
        this._pressureBarrier.removeBarrier(this._rightBarrier);
        this._rightBarrier.destroy();
      }

      // Since GNOME 46, the display property is not required anymore.
      if (GS_VERSION <= 45) {
        this._leftBarrier = new Meta.Barrier({
          display: global.display,
          x1: 0,
          x2: 0,
          y1: 1,
          y2: global.stage.height,
          directions: Meta.BarrierDirection.POSITIVE_X,
        });

        this._rightBarrier = new Meta.Barrier({
          display: global.display,
          x1: global.stage.width,
          x2: global.stage.width,
          y1: 1,
          y2: global.stage.height,
          directions: Meta.BarrierDirection.NEGATIVE_X,
        });
      } else {
        this._leftBarrier = new Meta.Barrier({
          backend: global.backend,
          x1: 0,
          x2: 0,
          y1: 1,
          y2: global.stage.height,
          directions: Meta.BarrierDirection.POSITIVE_X,
        });

        this._rightBarrier = new Meta.Barrier({
          backend: global.backend,
          x1: global.stage.width,
          x2: global.stage.width,
          y1: 1,
          y2: global.stage.height,
          directions: Meta.BarrierDirection.NEGATIVE_X,
        });
      }

      this._pressureBarrier.addBarrier(this._leftBarrier);
      this._pressureBarrier.addBarrier(this._rightBarrier);
    };

    // Re-create the barriers whenever the stage's allocation is changed.
    this._stageAllocationID = global.stage.connect('notify::allocation', createBarriers);
    createBarriers();

    // When the pressure barrier is triggered, the corresponding setting is enabled, and a
    // window is currently dragged, we move the dragged window to the adjacent workspace
    // and activate it as well.
    this._pressureBarrier.connect('trigger', () => {
      const direction =
        this._leftBarrier._isHit ? Meta.MotionDirection.LEFT : Meta.MotionDirection.RIGHT;

      const newWorkspace =
        global.workspace_manager.get_active_workspace().get_neighbor(direction);

      if (Main.actionMode == Shell.ActionMode.NORMAL && this._draggedWindow &&
          this._settings.get_boolean('enable-desktop-edge-switch')) {
        Main.wm.actionMoveWindow(this._draggedWindow, newWorkspace);
      } else if (Main.actionMode == Shell.ActionMode.NONE && Main.overview.visible &&
                 this._settings.get_boolean('enable-overview-edge-switch')) {
        newWorkspace.activate(global.get_current_time());
      }
    });

    // Keep a reference to the currently dragged window.
    global.display.connect('grab-op-begin', (d, win, op) => {
      if (op == Meta.GrabOp.MOVING) {
        this._draggedWindow = win;
      }
    });

    // Release the reference to the currently dragged window.
    global.display.connect('grab-op-end', (d, win, op) => {
      if (op == Meta.GrabOp.MOVING) {
        this._draggedWindow = null;
      }
    });


    // -----------------------------------------------------------------------------------
    // ------------------- fix perspective of multi-monitor setups -----------------------
    // -----------------------------------------------------------------------------------

    // Usually, GNOME Shell uses one central perspective for all monitors combined. This
    // results in a somewhat sheared appearance of the cube on multi-monitor setups where
    // the primary monitor is not in the middle (or cubes are shown on multiple monitors).
    // With the code below, we modify the projection and view matrices for each monitor so
    // that each monitor uses its own central perspective. This seems to be possible on
    // Wayland only. On X11, there's only one set of projection and view matrices for all
    // monitors combined, so we tweak them so that the projection center is in the middle
    // of the primary monitor. So it will at least only look bad on X11 if the cube is
    // shown on all monitors...
    const updateMonitorPerspective = () => {
      // Disable the perspective fixes first...
      this._disablePerspectiveCorrection();

      // Store this so we do not have to get it too often.
      this._enablePerMonitorPerspective =
        this._settings.get_boolean('per-monitor-perspective') &&
        global.display.get_n_monitors() > 1;

      // ... and then enable them if required.
      if (this._enablePerMonitorPerspective) {
        this._enablePerspectiveCorrection();
      }
    };

    this._settings.connect('changed::per-monitor-perspective', updateMonitorPerspective);
    this._monitorsChangedID = global.backend.get_monitor_manager().connect(
      'monitors-changed', updateMonitorPerspective);

    updateMonitorPerspective();


    // This is mostly the copy of initialization code from `WorkspaceAnimationController::_prepareWorkspaceSwitch()`
    // that usually calling before workspace animation starts. Since DesktopCube uses that animation controller,
    // the DesktopCube's function `updateMonitorGroup()` have an ability to work only if the animation controller
    // initialized. However, VR feature needs that function too. So, to pass the needed monitors group
    // to `updateMonitorGroup()` create them here.
    const get_monitor_groups = () =>  {
      let vr_monitors = []

      const workspaceManager = global.workspace_manager;
      const nWorkspaces = workspaceManager.get_n_workspaces();
      const workspaceIndices = [...Array(nWorkspaces).keys()];

      const monitors = Meta.prefs_get_workspaces_only_on_primary()
          ? [Main.layoutManager.primaryMonitor] : Main.layoutManager.monitors;

      for (const monitor of monitors) {
          if (Meta.prefs_get_workspaces_only_on_primary() &&
              monitor.index !== Main.layoutManager.primaryIndex)
              continue;

          const group = new MonitorGroup(monitor, workspaceIndices, null); 

          Main.uiGroup.insert_child_above(group, global.window_group);

          vr_monitors.push(group);
      }

      return vr_monitors;
    }

    var init_vr =
      () => {
        let activate_openhmd_backend = () => {
          this.gopenhmd = new GOpenHMD.Context();
          this.devs     = this.gopenhmd.enumerate();
          this.hmd      = this.gopenhmd.open_device(0, null);

          this._deactivate_openhmd_backend = () => {
            this.hmd            = null;
            this.devs           = null;
            this.gopenhmd       = null;
          }
        }

        let activate_openxr_backend = () => {
          this.gxr_ctx  = Gxr.Context.new("Desktop Cube", 1);

          this._deactivate_openxr_backend = () => {
            this.gxr_ctx            = null;
          }
        }

        let check_if_openhmd_active = () => {
          this.is_backend_openhmd = this._settings.get_boolean('radiobtn-backend-openhmd');
        }

        let check_if_openxr_active = () => {
          this.is_backend_openxr = this._settings.get_boolean('radiobtn-backend-openxr');
        }

        this._settings.connect('changed::radiobtn-backend-openhmd', () => {
          check_if_openhmd_active();

          if (this.is_backend_openhmd) {
            activate_openhmd_backend();
          } else {
            if (this._deactivate_openhmd_backend) {
              this._deactivate_openhmd_backend();
            }
          }
        })

        this._settings.connect('changed::radiobtn-backend-openxr', () => {
          check_if_openxr_active();

          if (this.is_backend_openhmd) {
            activate_openxr_backend();
          } else {
            if (this._deactivate_openxr_backend) {
              this._deactivate_openxr_backend();
            }
          }
        })

        check_if_openhmd_active();
        check_if_openxr_active();

        if (this.is_backend_openhmd) {
          activate_openhmd_backend();
        }

        if (this.is_backend_openxr) {
          activate_openxr_backend();
        }

        this.vr_monitors = get_monitor_groups();

        Meta.disable_unredirect_for_display(global.display);

        this.update_hmd = () => {
          var toEuler = (x, y, z, w, order) => {
            // https://github.com/rawify/Quaternion.js/blob/master/quaternion.js
            var wx = w * x, wy = w * y, wz = w * z;
            var xx = x * x, xy = x * y, xz = x * z;
            var yy = y * y, yz = y * z, zz = z * z;

            function asin(t) {
              return t >= 1 ? Math.PI / 2 : (t <= -1 ? -Math.PI / 2 : Math.asin(t));
            }

            if (order === undefined || order === 'ZXY') {
              return [
                -Math.atan2(2 * (xy - wz), 1 - 2 * (xx + zz)),
                asin(2 * (yz + wx)),
                -Math.atan2(2 * (xz - wy), 1 - 2 * (xx + yy)),
              ];
            }

            if (order === 'XYZ' || order === 'RPY') {
              return [
                -Math.atan2(2 * (yz - wx), 1 - 2 * (xx + yy)),
                asin(2 * (xz + wy)),
                -Math.atan2(2 * (xy - wz), 1 - 2 * (yy + zz)),
              ];
            }

            return null;
          };

          // Preserve for whole update to be atomic
          let is_backend_openhmd = this.is_backend_openhmd;
          let is_backend_openxr = this.is_backend_openxr;

          if (is_backend_openhmd) {
            this.gopenhmd.update();
          }
          
          if (is_backend_openxr) {
            var [pose_ret, pose] = this.gxr_ctx.get_head_pose();
            if (pose_ret) {
              //pose.print()
            } else {
              console.log('no pose received')
              return;
            }
          }

          if (is_backend_openhmd) {
            var q     = this.hmd.rotation_quat();
            var euler = toEuler(q.x, q.y, q.z, q.w, 'XYZ');
          }

          if (is_backend_openxr) {
            var [decompose_ret, , , q, , ]  = pose.decompose();
            if (decompose_ret) {
              //q.print()
            } else {
              console.log('no graphene matrix decompose possible')
              return;
            }
            var euler = q.to_angles()
          }

          if (is_backend_openhmd) {
            const additional_empirical_adjust_k = 0.65;

            const k = 100 * additional_empirical_adjust_k;

            this.rot_x = euler[0] * k;
            this.rot_y = euler[1] * k;
            this.rot_z = euler[2] * k;
          }

          if (is_backend_openxr) {
            this.rot_x = euler[0];
            this.rot_y = euler[1];
            this.rot_z = euler[2];
          }
        };

        this.workspacesView = undefined;
        this.hmd_poller_fn = () => {
          if (this._cursorBeamEffect) {
            let [mouse_x, mouse_y] = global.get_pointer();

            this._cursorBeamEffect.updateEffect(
              {
                rot_x: this.rot_x ? this.rot_x : 0.0,
                rot_y: this.rot_y ? this.rot_y : 0.0,
                rot_z: this.rot_z ? this.rot_z : 0.0,
                pointer_pos_x: mouse_x,
                pointer_pos_y: mouse_y
              }
            )
          }

          try {
            this.update_hmd();

            const update_workspace =
              () => {
                if (this.workspacesView) {
                  this.workspacesView._updateWorkspacesState();
                }
              }

            const update_monitor_group =
              () => {
                if (this.vr_monitors) {
                  for (const vr_monitor of this.vr_monitors) {
                    updateMonitorGroup(vr_monitor);
                  }
                }
              }

            switch (Main.actionMode) {
              // SHELL_ACTION_MODE_NONE is active when windows is
              // dragging between workspaces
              case Shell.ActionMode.NONE:
              case Shell.ActionMode.OVERVIEW:
                update_workspace();
                break;
              case Shell.ActionMode.NORMAL:
                update_monitor_group();
                break;
              // Noticed if click right button on desktop
              // or if opened the notification panel
              case Shell.ActionMode.POPUP:
                // Could be on normal as well as on overview
                // So just update both
                update_workspace();
                update_monitor_group();
                break;
              default:
                console.error('Unhandled action mode: ' + Main.actionMode);
            }
          } catch (ex) {
            this._settings.set_boolean('enable-vr', false);
            // Look at error by `journalctl -r /usr/bin/gnome-shell`
            console.error(ex);
            return;
          }

          if (this._skybox) {
            const magic_pitch_k = 0.015;
            this._skybox.pitch  = this.rot_x * magic_pitch_k;
            this._skybox.yaw    = this.rot_y * magic_pitch_k;
          }
        };

        let loop = () => {
          let timeout;

          let is_backend_openhmd = this.is_backend_openhmd;
          let is_backend_openxr = this.is_backend_openxr;

          if (is_backend_openhmd) { timeout = 16 }; // TODO: how to keep updates synced with frames?
          if (is_backend_openxr) { timeout = 10 }; // Rate will be delayed by special wait function
          setTimeout(() => {
            if (is_backend_openhmd) { this.hmd_poller_fn() }

            if (is_backend_openxr) { 
              // Needed to follow correct call order with begin/end frame.
              // It also controls loop rate
              this.gxr_ctx.wait_frame(); // TODO: probably not a good idea to lock js thread

              // Calling begin/end frame allows to set `predicted_display_time` internally
              // Without that `get_head_pose()` returns delayed data
              this.gxr_ctx.begin_frame();
              this.gxr_ctx.end_frame();
              
              this.hmd_poller_fn()
            }

            loop();
          }, timeout);
        };

        loop(); // Start setTimeout chain
        
        try {
          this._cursorBeamEffect = new CorsorBeam(1920, 1080);
          Main.uiGroup.add_effect_with_name('CorsorBeam', this._cursorBeamEffect);
          console.warn('CursorBeam effect is loaded');
        } catch (ex) {
          console.error(ex);
          console.warn('CursorBeam effect is not loaded');
        }
      }

    if (this._settings.get_boolean('enable-vr')) {
      try {
        init_vr();
      } catch (ex) {
        this._settings.set_boolean('enable-vr', false);
        // Look at error by `journalctl -r /usr/bin/gnome-shell`
        console.error(ex);
      }
    }

    this._settings.connect('changed::enable-vr', () => {
      if (this._settings.get_boolean('enable-vr')) {
        try {
          init_vr();
        } catch (ex) {
          this._settings.set_boolean('enable-vr', false);
        }
      } else {
        clearInterval(this.hmd_poller);

        this._scrollAdjustment = null;

        this.hmd_poller_fn  = null;
        this.update_hmd     = null;
        this.workspacesView = null;
        this.monitors       = null;

        if (this._deactivate_openhmd_backend) {
          this._deactivate_openhmd_backend();
        }

        if (this._deactivate_openxr_backend) {
          this._deactivate_openxr_backend();
        }
      }
    });
  }

  // This function could be called after the extension is uninstalled, disabled in GNOME
  // Tweaks, when you log out or when the screen locks.
  disable() {
    if (this._settings.get_boolean('enable-vr')) {
      if (this._cursorBeamEffect) {
        Main.uiGroup.remove_effect_by_name('CursorBeam');
      };
      clearInterval(this.hmd_poller);
    }

    // Restore the original behavior.
    SwipeTracker.prototype._endGesture              = this._origEndGesture;
    WorkspacesView.prototype._updateWorkspacesState = this._origUpdateWorkspacesState;
    WorkspacesView.prototype._getSpacing            = this._origGetSpacing;
    WorkspacesView.prototype._updateVisibility      = this._origUpdateVisibility;
    WorkspacesView.prototype._onScrollAdjustmentChanged = this._origOnScrollAdjustmentChanged;
    WorkspaceAnimationController.prototype._prepareWorkspaceSwitch = this._origPrepSwitch;
    WorkspaceAnimationController.prototype._finishWorkspaceSwitch = this._origFinalSwitch;
    WorkspaceGroup.prototype._init                  = this._origWorkspaceGroupInit;
    WorkspaceGroup.prototype._createClone           = this._origWorkspaceGroupCreateClone;

    // Remove all drag-to-rotate gestures.
    this._removeDesktopDragGesture();
    this._removePanelDragGesture();
    this._removeOverviewDragGesture();

    // Clean up skybox.
    if (this._skybox) {
      this._skybox.destroy();
      this._skybox = null;
    }

    // Clean up the edge-workspace-switching.
    global.stage.disconnect(this._stageAllocationID);

    this._pressureBarrier.destroy();
    this._leftBarrier.destroy();
    this._rightBarrier.destroy();

    this._pressureBarrier = null;
    this._leftBarrier     = null;
    this._rightBarrier    = null;

    if (this._settings.get_boolean('enable-vr')) {
      this._scrollAdjustment = null;
      this.vr_monitors    = null;
      this.monitors       = null;
      this.workspacesView = null;

      if (this._deactivate_openhmd_backend) {
        this._deactivate_openhmd_backend();
      }

      if (this._deactivate_openxr_backend) {
        this._deactivate_openxr_backend();
      }
    }

    // Clean up perspective correction.
    this._disablePerspectiveCorrection();
    global.backend.get_monitor_manager().disconnect(this._monitorsChangedID);

    // Make sure that the settings object is freed.
    this._settings = null;
  }

  // ----------------------------------------------------------------------- private stuff

  // Calls inhibit_culling on the given actor and recursively on all mapped children.
  _inhibitCulling(actor) {
    if (actor.mapped) {
      actor.inhibit_culling();
      actor._culling_inhibited_by_desktop_cube = true;
      actor.get_children().forEach(c => this._inhibitCulling(c));
    }
  };

  // Calls uninhibit_culling on the given actor and recursively on all children. It will
  // only call uninhibit_culling() on those actors which were inhibited before.
  _uninhibitCulling(actor) {
    if (actor._culling_inhibited_by_desktop_cube) {
      delete actor._culling_inhibited_by_desktop_cube;
      actor.uninhibit_culling();
      actor.get_children().forEach(c => this._uninhibitCulling(c));
    }
  };

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
  // the same parent) by increasing absolute rotation-y angle. This is used for
  // depth-sorting, as cube faces which are less rotated, are in front of others.
  _depthSortCubeFaces(actors) {
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

  // This sorts the given list of children actors (which are supposed to be attached to
  // the same parent) by increasing orthogonal distance to the camera. To do this, the
  // camera position is projected onto the plane defined by the actor and the absolute
  // distance from the camera to its projected position is computed. This is used for
  // depth-sorting a list of parallel actors.
  _depthSortWindowActors(actors, monitorIndex) {

    // Sanity check.
    if (actors.length <= 1) {
      return;
    }

    // First, compute distance of virtual camera to the front workspace plane.
    const camera = new Graphene.Point3D({
      x: global.stage.width / 2,
      y: global.stage.height / 2,
      z: global.stage.height /
        (2 * Math.tan(global.stage.perspective.fovy / 2 * Math.PI / 180))
    });

    // All actors are expected to share the same parent.
    const parent = actors[0].get_parent();

    // If the perspective is corrected for multi-monitor setups, the virtual camera is not
    // in the middle of the stage but rather in front of each monitor.
    if (this._enablePerMonitorPerspective) {

      let monitor;

      if (Meta.is_wayland_compositor()) {

        // On Wayland, each monitor should have its own StageView. Therefore, the virtual
        // camera has been positioned in front of each monitor separately.
        monitor = global.display.get_monitor_geometry(monitorIndex);

      } else {

        // On X11, there's only one StageView. We move the virtual camera so that it is in
        // front of the primary monitor.
        monitor =
          global.display.get_monitor_geometry(global.display.get_primary_monitor());
      }

      camera.x = monitor.x + monitor.width / 2;
      camera.y = monitor.y + monitor.height / 2;
    }

    // Create a list of the orthogonal distances to the camera for each actor.
    const distances = actors.map((a, i) => {
      // A point on the actor plane.
      const onActor = a.apply_relative_transform_to_point(
        null, new Graphene.Point3D({x: 0, y: 0, z: 0}));

      // A point one unit above the actor plane.
      const aboveActor = a.apply_relative_transform_to_point(
        null, new Graphene.Point3D({x: 0, y: 0, z: 1000}));

      // The normal vector on the actor plane.
      const normal = new Graphene.Point3D({
        x: aboveActor.x - onActor.x,
        y: aboveActor.y - onActor.y,
        z: aboveActor.z - onActor.z,
      });

      const length =
        Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
      normal.x /= length;
      normal.y /= length;
      normal.z /= length;

      onActor.x -= camera.x;
      onActor.y -= camera.y;
      onActor.z -= camera.z;

      // Return the length of the projected vector.
      return {
        index: i,
        distance: onActor.x * normal.x + onActor.y * normal.y + onActor.z * normal.z
      };
    });

    // Sort by decreasing distance.
    distances.sort((a, b) => {
      return Math.abs(b.distance) - Math.abs(a.distance);
    });

    // Then use this to create a sorted list of actors.
    const copy = distances.map(e => {
      return actors[e.index];
    });

    // Finally, sort the children actors accordingly.
    for (let i = 0; i < copy.length; i++) {
      parent.set_child_at_index(copy[i], -1);
    }
  }

  // During rotations, the cube is scaled down and the windows are "exploded". If we
  // are directly facing a cube side, the strengths of both effects are approaching
  // zero. The strengths of both effects are small during horizontal rotations to make
  // workspace-switching not so obtrusive. However, during vertical rotations, the
  // effects are stronger.
  // This method returns two values:
  // result[0]: A translation value by which the cube should be moved backwards.
  // result[1]: A translation value by which windows may be moved away from the cube.
  _getExplodeFactors(hRotation, vRotation, centerDepth, monitorIndex) {

    // These are zero if we are facing a workspace and one if we look directly at an
    // edge between adjacent workspaces or if the cube is rotated vertically
    // respectively.
    const hFactor = 1.0 - 2.0 * Math.abs(hRotation % 1 - 0.5);
    const vFactor = Math.abs(vRotation);

    // For horizontal rotations, we want to scale the cube (or rather move it backwards)
    // a tiny bit to reveal a bit of parallax. However, if we have many cube sides, this
    // looks weird, so we reduce the effect there. We use the offset which would make
    // the cube's corners stay behind the original workspace faces during he rotation.
    const monitor = global.display.get_monitor_geometry(monitorIndex);
    const cornerDist =
      Math.sqrt(Math.pow(centerDepth, 2) + Math.pow(monitor.width / 2, 2));
    const hDepthOffset =
      this._settings.get_double('window-parallax') * (cornerDist - centerDepth);

    // The explode factor is set to the hDepthOffset value to make the front-most
    // window stay at a constant depth.
    // if (this._settings.get_boolean('enable-vr')) {
    // const hExplode = -hDepthOffset;
    // } else {
    const hExplode = hDepthOffset;
    // }

    // For vertical rotations, we move the cube backwards to reveal everything. The
    // maximum explode width is set to half of the workspace size.
    const vExplode = this._settings.get_boolean('do-explode') ?
      Math.max(monitor.width, monitor.height) / 2 :
      0;
    const diameter = 2 * (vExplode + centerDepth);
    const camDist =
      monitor.height / (2 * Math.tan(global.stage.perspective.fovy / 2 * Math.PI / 180));
    const vDepthOffset =
      (1 + PADDING_V_ROTATION) * diameter * camDist / monitor.width - centerDepth;

    // Use current maximum of both values.
    const depthOffset = Math.max(hFactor * hDepthOffset, vFactor * vDepthOffset);
    const explode     = Math.max(hFactor * hExplode, vFactor * vExplode);

    // Do not explode the cube in app drawer state. The stateAdjustment is...
    // ... 0 on the desktop
    // ... 1 in the window picker
    // ... 2 in the app drawer
    const windowPickerFactor =
      Math.min(1.0, 2.0 - Main.overview._overview.controls._stateAdjustment.value);

    return [depthOffset * windowPickerFactor, explode * windowPickerFactor];
  }

  // Usually, GNOME Shell uses one central perspective for all monitors combined. This
  // results in a somewhat sheared appearance of the cube on multi-monitor setups where
  // the primary monitor is not in the middle (or cubes are shown on multiple monitors).
  // With the code below, we modify the projection and view matrices for each monitor so
  // that each monitor uses its own central perspective. This seems to be possible on
  // Wayland only. On X11, there's only one set of projection and view matrices for all
  // monitors combined, so we tweak them so that the projection center is in the middle of
  // the primary monitor. So it will at least only look bad on X11 if the cube is shown on
  // all monitors...
  _enablePerspectiveCorrection() {

    this._stageBeforeUpdateID = global.stage.connect('before-update', (stage, view) => {
      // Do nothing if neither overview or desktop switcher are shown.
      if (!Main.overview.visible && Main.wm._workspaceAnimation._switchData == null) {
        return;
      }

      // Usually, the virtual camera is positioned centered in front of the stage. We will
      // move the virtual camera around. These variables will be the new stage-relative
      // coordinates of the virtual camera.
      let cameraX, cameraY;

      if (Meta.is_wayland_compositor()) {

        // On Wayland, each monitor has its own StageView. Therefore we can move the
        // virtual camera for each monitor separately.
        cameraX = view.layout.x + view.layout.width / 2;
        cameraY = view.layout.y + view.layout.height / 2;

      } else {

        // On X11, there's only one StageView. We move the virtual camera so that it is in
        // front of the current monitor.
        const currentMonitorRect =
          global.display.get_monitor_geometry(global.display.get_current_monitor());

        cameraX = currentMonitorRect.x + currentMonitorRect.width / 2;
        cameraY = currentMonitorRect.y + currentMonitorRect.height / 2;
      }

      // This is the offset to the original, centered camera position. Y is flipped due to
      // some negative scaling at some point in Mutter.
      const camOffsetX = stage.width / 2 - cameraX;
      const camOffsetY = cameraY - stage.height / 2;

      const z_near = stage.perspective.z_near;
      const z_far  = stage.perspective.z_far;

      // The code below is copied from Mutter's Clutter.
      // https://gitlab.gnome.org/GNOME/mutter/-/blob/main/clutter/clutter/clutter-stage.c#L2255
      const A = 0.57735025882720947265625;
      const B = 0.866025388240814208984375;
      const C = 0.86162912845611572265625;
      const D = 0.00872653536498546600341796875;

      const z_2d = z_near * A * B * C / D + z_near;

      // The code below is copied from Mutter's Clutter as well.
      // https://gitlab.gnome.org/GNOME/mutter/-/blob/main/clutter/clutter/clutter-stage.c#L2270
      const top    = z_near * Math.tan(stage.perspective.fovy * Math.PI / 360.0);
      const left   = -top * stage.perspective.aspect;
      const right  = top * stage.perspective.aspect;
      const bottom = -top;

      const left_2d_plane   = left / z_near * z_2d;
      const right_2d_plane  = right / z_near * z_2d;
      const bottom_2d_plane = bottom / z_near * z_2d;
      const top_2d_plane    = top / z_near * z_2d;

      const width_2d_start  = right_2d_plane - left_2d_plane;
      const height_2d_start = top_2d_plane - bottom_2d_plane;

      const width_scale  = width_2d_start / stage.width;
      const height_scale = height_2d_start / stage.height;
      // End of the copy-paste code.

      // Compute the required offset of the frustum planes at the near plane. This
      // basically updates the projection matrix according to our new camera position.
      const offsetX = camOffsetX * width_scale / z_2d * z_near;
      const offsetY = camOffsetY * height_scale / z_2d * z_near;

      // Set the new frustum.
      view.get_framebuffer().frustum(left + offsetX, right + offsetX, bottom + offsetY,
                                     top + offsetY, z_near, z_far);

      // Translate the virtual camera. This basically updates the view matrix according to
      // our new camera position.
      view.get_framebuffer().push_matrix();
      view.get_framebuffer().translate(camOffsetX * width_scale,
                                       camOffsetY * height_scale, 0);

      // If the perspective of each monitor is computed separately, the culling of GNOME
      // Shell does not work anymore as it still uses the original frustum. The only
      // workaround is to disable culling altogether. This will be bad performance-wise,
      // but I do not see an alternative.
      // If the overview is shown, we inhibit culling for the WorkspacesDisplay. If the
      // desktop-workspace-switcher is shown, we inhibit culling for all shown monitor
      // groups.
      if (Main.overview.visible) {
        this._inhibitCulling(Main.overview._overview.controls._workspacesDisplay);
      } else if (Main.wm._workspaceAnimation._switchData) {
        Main.wm._workspaceAnimation._switchData.monitors.forEach(m => {
          this._inhibitCulling(m);
        });
      }
    });

    // Revert the matrix changes before the update,
    this._stageAfterUpdateID = global.stage.connect('after-update', (stage, view) => {
      // Nothing to do if neither overview or desktop switcher are shown.
      if (!Main.overview.visible && Main.wm._workspaceAnimation._switchData == null) {
        return;
      }

      view.get_framebuffer().pop_matrix();
      view.get_framebuffer().perspective(stage.perspective.fovy, stage.perspective.aspect,
                                         stage.perspective.z_near,
                                         stage.perspective.z_far);

      // Re-enable culling for all relevant actors.
      if (Main.overview.visible) {
        this._uninhibitCulling(Main.overview._overview.controls._workspacesDisplay);
      } else if (Main.wm._workspaceAnimation._switchData) {
        Main.wm._workspaceAnimation._switchData.monitors.forEach(m => {
          this._uninhibitCulling(m);
        });
      }
    });
  }

  // Reverts the changes done with the method above.
  _disablePerspectiveCorrection() {

    if (this._stageBeforeUpdateID) {
      global.stage.disconnect(this._stageBeforeUpdateID);
      this._stageBeforeUpdateID = 0;
    }

    if (this._stageAfterUpdateID) {
      global.stage.disconnect(this._stageAfterUpdateID);
      this._stageAfterUpdateID = 0;
    }
  }

  // This creates a custom drag gesture and adds it to the given SwipeTracker. The swipe
  // tracker will now also respond to horizontal drags. The additional gesture also
  // reports vertical drag movements via the "pitch" property. This method returns an
  // object containing the gesture, an St.Adjustment which will contain this pitch value,
  // and a connection ID which is used by _removeDragGesture() to clean up. When the
  // SwipeTracker's gesture ends, the St.Adjustment's value will be eased to zero.
  _addDragGesture(actor, tracker, mode) {
    const gesture = new DragGesture(actor, mode);
    gesture.connect('begin', tracker._beginGesture.bind(tracker));
    gesture.connect('update', tracker._updateGesture.bind(tracker));
    gesture.connect('end', tracker._endTouchGesture.bind(tracker));
    tracker.bind_property('distance', gesture, 'distance',
                          GObject.BindingFlags.SYNC_CREATE);

    // Update the gesture's sensitivity when the corresponding settings value changes.
    this._settings.bind('mouse-rotation-speed', gesture, 'sensitivity',
                        Gio.SettingsBindFlags.GET);

    // Connect the gesture's pitch property to the pitch adjustment.
    gesture.bind_property('pitch', this._pitch, 'value', 0);

    // Ease the pitch adjustment to zero if the SwipeTracker reports an ended gesture.
    // This ensures that the cube smoothly rotates back when released. The end-signal
    // returns a suitable duration for this, however this depends on the horizontal
    // rotation required to move the cube back. Here, we compute a duration required for
    // the vertical rotation and use the maximum of both values for the final easing.
    const gestureEndID = tracker.connect('end', (g, duration) => {
      this._pitch.remove_transition('value');
      this._pitch.ease(0, {
        duration: Math.max(500 * Math.abs(this._pitch.value), duration),
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      });
    });

    // We return all things which are required to remove the gesture again. This can be
    // done with the _removeDragGesture() method below.
    return {
      actor: actor,
      tracker: tracker,
      gesture: gesture,
      trackerConnection: gestureEndID
    };
  }

  // Removes a single-click drag gesture created earlier via _addDragGesture(). The info
  // parameter should be the object returned by _addDragGesture().
  _removeDragGesture(info) {
    info.gesture.destroy();
    info.tracker.disconnect(info.trackerConnection);
  }

  // Calls _addDragGesture() for the SwipeTracker and actor responsible for
  // workspace-switching in desktop mode when dragging on the background.
  _addDesktopDragGesture() {
    // The SwipeTracker for switching workspaces in desktop mode is created here:
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspaceAnimation.js#L285
    const tracker = Main.wm._workspaceAnimation._swipeTracker;
    let actor     = Main.layoutManager._backgroundGroup;
    const mode    = Shell.ActionMode.NORMAL;

    // If not in the overview, you can usually only swipe to adjacent workspaces. This
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/swipeTracker.js#L633
    // allows us to override this behavior.
    tracker.allowLongSwipes = true;

    // We have to make the background reactive. Make sure to store the current state so
    // that we can reset it later.
    this._origBackgroundReactivity = actor.reactive;
    actor.reactive                 = true;

    this._desktopDragGesture = this._addDragGesture(actor, tracker, mode);
  }

  // Calls _addDragGesture() for the SwipeTracker and actor responsible for
  // workspace-switching in desktop mode when dragging on the panel.
  _addPanelDragGesture() {
    // The SwipeTracker for switching workspaces in desktop mode is created here:
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspaceAnimation.js#L285
    const tracker = Main.wm._workspaceAnimation._swipeTracker;
    const actor   = Main.panel;
    const mode    = Shell.ActionMode.NORMAL;

    // If not in the overview, you can usually only swipe to adjacent workspaces. This
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/swipeTracker.js#L633
    // allows us to override this behavior.
    tracker.allowLongSwipes = true;

    // We have to prevent moving fullscreen windows when dragging.
    this._origPanelTryDragWindow = actor._tryDragWindow;
    actor._tryDragWindow = () => Clutter.EVENT_PROPAGATE;

    this._panelDragGesture = this._addDragGesture(actor, tracker, mode);
  }

  // Calls _addDragGesture() for the SwipeTracker and actor responsible for
  // workspace-switching in overview mode.
  _addOverviewDragGesture() {
    // The SwipeTracker for switching workspaces in overview mode is created here:
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspacesView.js#L827
    const tracker = Main.overview._overview._controls._workspacesDisplay._swipeTracker;
    const actor   = Main.layoutManager.overviewGroup;
    const mode    = Shell.ActionMode.OVERVIEW;

    this._overviewDragGesture = this._addDragGesture(actor, tracker, mode);
  }

  // Calls _removeDragGesture() for the SwipeTracker and actor responsible for
  // workspace-switching in desktop mode when dragging on the background.
  _removeDesktopDragGesture() {
    if (this._desktopDragGesture) {

      // Restore original behavior.
      this._desktopDragGesture.tracker.allowLongSwipes = false;

      // Make sure to restore the original state.
      this._desktopDragGesture.actor.reactive = this._origBackgroundReactivity;

      this._removeDragGesture(this._desktopDragGesture);

      delete this._desktopDragGesture;
    }
  }

  // Calls _removeDragGesture() for the SwipeTracker and actor responsible for
  // workspace-switching in desktop mode when dragging on the panel.
  _removePanelDragGesture() {
    if (this._panelDragGesture) {

      // Restore original behavior.
      this._panelDragGesture.tracker.allowLongSwipes = false;

      // Make sure to restore the original state.
      this._panelDragGesture.actor._tryDragWindow = this._origPanelTryDragWindow;

      this._removeDragGesture(this._panelDragGesture);

      delete this._panelDragGesture;
    }
  }

  // Calls _removeDragGesture() for the SwipeTracker and actor responsible for
  // workspace-switching in overview mode.
  _removeOverviewDragGesture() {
    if (this._overviewDragGesture) {
      this._removeDragGesture(this._overviewDragGesture);

      delete this._overviewDragGesture;
    }
  }
}

// This function is called once when the extension is loaded, not enabled.
function init() {
  return new Extension();
}
