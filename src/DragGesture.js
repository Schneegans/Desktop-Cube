//////////////////////////////////////////////////////////////////////////////////////////
// ,-.  ,--.  ,-.  ,  , ,---.  ,-.  ;-.     ,-. .  . ,-.  ,--.       Copyright (c) 2021 //
// |  \ |    (   ` | /    |   /   \ |  )   /    |  | |  ) |            Simon Schneegans //
// |  | |-    `-.  |<     |   |   | |-'    |    |  | |-<  |-   Released under the GPLv3 //
// |  / |    .   ) | \    |   \   / |      \    |  | |  ) |       or later. See LICENSE //
// `-'  `--'  `-'  '  `   '    `-'  '       `-' `--` `-'  `--'        file for details. //
//////////////////////////////////////////////////////////////////////////////////////////

'use strict';

const {Clutter, GObject, Shell} = imports.gi;

const Util          = imports.misc.util;
const Main          = imports.ui.main;
const ControlsState = imports.ui.overviewControls.ControlsState;

const ExtensionUtils = imports.misc.extensionUtils;
const Me             = imports.misc.extensionUtils.getCurrentExtension();
const utils          = Me.imports.src.utils;

//////////////////////////////////////////////////////////////////////////////////////////
// In GNOME Shell, SwipeTrackers are used all over the place to capture swipe gestures. //
// There's one for entering the overview, one for switching workspaces in desktop mode, //
// one for switching workspaces in overview mode, one for horizontal scrolling in the   //
// app drawer, and many more. The ones used for workspace-switching usually do not      //
// respond to single-click dragging but only to multi-touch gestures. We want to be     //
// able to rotate the cube with the left mouse button, so we add an additional gesture  //
// to these two SwipeTracker instances tracking single-click drags. The gesture is      //
// loosely based on the TouchSwipeGesture defined here:                                 //
// https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/swipeTracker.js#L213    //
// It behaves the same in the regard that it reports update events for horizontal       //
// movements. However, it stores vertical movements as well and makes this accessible   //
// via the "pitch" property. This is then used for vertical rotations of the cube.      //
//////////////////////////////////////////////////////////////////////////////////////////

// clang-format off
var DragGesture =
  GObject.registerClass({
      Properties: {
        'distance': GObject.ParamSpec.double(
          'distance', 'distance', 'distance', GObject.ParamFlags.READWRITE, 0, Infinity, 0),
        'pitch': GObject.ParamSpec.double(
          'pitch', 'pitch', 'pitch', GObject.ParamFlags.READWRITE, 0, 1, 0),
      },
      Signals: {
        'begin':  {param_types: [GObject.TYPE_UINT, GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE]},
        'update': {param_types: [GObject.TYPE_UINT, GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE]},
        'end':    {param_types: [GObject.TYPE_UINT, GObject.TYPE_DOUBLE]},
        'cancel': {param_types: [GObject.TYPE_UINT, GObject.TYPE_DOUBLE]},
      },
    },
    class DragGesture extends Clutter.GestureAction {
  // clang-format on
  _init(mode) {
    super._init();
    this.set_n_touch_points(1);
    this.set_threshold_trigger_edge(Clutter.GestureTriggerEdge.AFTER);

    this._mode   = mode;
    this._lastX  = 0;
    this._startY = 0;
  }

  // Called before the gesture actually starts, it can abort the gesture by returning
  // false.
  vfunc_gesture_prepare(actor) {
    if (!super.vfunc_gesture_prepare(actor)) {
      return false;
    }

    // Abort if the gesture is not meant for the current action mode (e.g. either
    // Shell.ActionMode.OVERVIEW or Shell.ActionMode.NORMAL).
    if (this._mode != Main.actionMode) {
      return false;
    }

    // In the overview, we only want to switch workspaces by dragging when in
    // window-picker state.
    if (Main.actionMode == Shell.ActionMode.OVERVIEW) {
      if (Main.overview._overview.controls._stateAdjustment.value !=
          ControlsState.WINDOW_PICKER) {
        return false;
      }
    }

    // When starting a drag in desktop mode, we grab the input so that we can move the
    // pointer across windows without loosing the input events.
    if (Main.actionMode == Shell.ActionMode.NORMAL) {
      if (!this._grab(actor)) {
        return false;
      }
    }

    // Store the start coordinates of the gesture.
    const time                  = this.get_last_event(0).get_time();
    const [xPress, yPress]      = this.get_press_coords(0);
    [this._lastX, this._startY] = this.get_motion_coords(0);

    this.pitch = 0;

    this.emit('begin', time, xPress, yPress);
    return true;
  }

  // Called on pointer or touch-movement events.
  vfunc_gesture_progress(_actor) {

    // Compute the horizontal movement relative to the last call.
    const [x, y] = this.get_motion_coords(0);
    let deltaX   = x - this._lastX;
    this._lastX  = x;

    // Compute the accumulated pitch relative to the screen height.
    this.pitch = (this._startY - y) / global.screen_height;

    // Increase horizontal movement if the cube is rotated vertically.
    deltaX *=
        Util.lerp(1.0, global.workspaceManager.get_n_workspaces(), Math.abs(this.pitch));

    const time = this.get_last_event(0).get_time();
    this.emit('update', time, -deltaX, this.distance);

    return true;
  }

  // Called when the gesture is ended by the user.
  vfunc_gesture_end(_actor) {

    // Cancel the ongoing grab in desktop mode.
    if (Main.actionMode == Shell.ActionMode.NORMAL) {
      this._ungrab();
    }

    const time = this.get_last_event(0).get_time();
    this.emit('end', time, this.distance);
  }

  // Called when the gesture is canceled by some event.
  vfunc_gesture_cancel(_actor) {

    // Cancel the ongoing grab in desktop mode.
    if (Main.actionMode == Shell.ActionMode.NORMAL) {
      this._ungrab();
    }

    const time = Clutter.get_current_event_time();
    this.emit('cancel', time, this.distance);
  }

  // Makes sure that all events from the pointing device we received last input from is
  // passed to the given actor. This is used to ensure that we do not "loose" the touch
  // buttons will dragging them around.
  _grab(actor) {
    if (utils.shellVersionIsAtLeast(42, 0)) {
      this.get_device(0).grab(actor);
    }
    return global.begin_modal(0, 0);
  }

  // Releases a grab created with the method above.
  _ungrab() {
    if (utils.shellVersionIsAtLeast(42, 0)) {
      this.get_device(0).ungrab();
    }

    global.end_modal(0);
  }
});