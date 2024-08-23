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
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import GOpenHMD from 'gi://GOpenHMD';

// try {
//   var ns = await import('gi://GOpenHMD')
//   var GOpenHMD = ns.GOpenHMD;
  var is_gopenhmd_available = true
// } catch (ex) {
//   var is_gopenhmd_available = false
// }

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {registerImageChooserButton} from './src/ImageChooserButton.js';
import {setInterval, clearInterval} from './src/utils.js';

//////////////////////////////////////////////////////////////////////////////////////////
// For now, the preferences dialog of this extension is very simple. In the future, if  //
// we might consider to improve its layout...                                           //
//////////////////////////////////////////////////////////////////////////////////////////

export default class DesktopCubePreferences extends ExtensionPreferences {

  // -------------------------------------------------------------------- public interface

  // This function is called when the preferences window is created. We create a new
  // instance of the PreferencesDialog class each time this method is called. This way we
  // can actually open multiple settings windows and interact with all of them properly.
  fillPreferencesWindow(window) {
    // Load all of our resources.
    this._resources = Gio.Resource.load(this.path + '/resources/desktop-cube.gresource');
    Gio.resources_register(this._resources);

    // Register our custom widgets.
    registerImageChooserButton();

    // Load the user interface file.
    this._builder = new Gtk.Builder();
    this._builder.add_from_resource(`/ui/settings.ui`);
    if (is_gopenhmd_available === true) {
      this._builder.add_from_resource(`/ui/vr-page.ui`);
    }

    // Make sure custom icons are found.
    Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_resource_path('/img');

    // These are our top-level preferences pages which we will return later.
    this._pages = [
      this._builder.get_object('general-page'), this._builder.get_object('desktop-page'),
      this._builder.get_object('overview-page')
    ];

    this._vr_mode_add_page(this._pages);

    // Store a reference to the settings object.
    this._settings = this.getSettings();

    // Bind all properties.
    this._bindAdjustment('workpace-separation');
    this._bindAdjustment('horizontal-stretch');
    this._bindAdjustment('window-parallax');
    this._bindImageChooserButton('background-panorama');
    this._bindSwitch('last-first-gap');
    this._bindSwitch('enable-desktop-dragging');
    this._bindSwitch('enable-panel-dragging');
    this._bindSwitch('enable-desktop-edge-switch');
    this._bindSwitch('enable-overview-edge-switch');
    this._bindSwitch('enable-overview-dragging');
    this._bindSwitch('do-explode');
    this._bindSwitch('per-monitor-perspective');
    this._bindAdjustment('active-workpace-opacity');
    this._bindAdjustment('inactive-workpace-opacity');
    this._bindAdjustment('edge-switch-pressure');
    this._bindAdjustment('mouse-rotation-speed');

    // VR mode
    this._settings.bind('enable-vr', this._builder.get_object('enable-vr'), 'active',
      Gio.SettingsBindFlags.DEFAULT);

    // Inject the video link.
    const label    = this._builder.get_object('central-perspective-row');
    label.subtitle = label.subtitle.replace(
      '%s', '<a href="https://youtu.be/dpYyn1BXGjU">https://youtu.be/dpYyn1BXGjU</a>');

    // Add a menu to the title bar of the preferences dialog.
    this._pages[0].connect('realize', (widget) => {
      const window = widget.get_root();

      // Add the menu to the header bar.
      const menu   = this._builder.get_object('menu-button');
      const header = this._findWidgetByType(window.get_content(), Adw.HeaderBar);
      header.pack_start(menu);

      // Populate the actions.
      const group = Gio.SimpleActionGroup.new();

      const addAction = (name, uri) => {
        const action = Gio.SimpleAction.new(name, null);
        action.connect('activate', () => Gtk.show_uri(null, uri, Gdk.CURRENT_TIME));
        group.add_action(action);
      };

      // clang-format off
      addAction('homepage',      'https://github.com/Schneegans/Desktop-Cube');
      addAction('changelog',     'https://github.com/Schneegans/Desktop-Cube/blob/main/docs/changelog.md');
      addAction('translate',     'https://hosted.weblate.org/engage/desktop-cube/');
      addAction('bugs',          'https://github.com/Schneegans/Desktop-Cube/issues');
      addAction('donate-kofi',   'https://ko-fi.com/schneegans');
      addAction('donate-github', 'https://github.com/sponsors/Schneegans');
      addAction('donate-paypal', 'https://www.paypal.me/simonschneegans');
      addAction('show-sponsors', 'https://schneegans.github.io/sponsors');
      // clang-format on

      // Add the about dialog.
      const aboutAction = Gio.SimpleAction.new('about', null);
      aboutAction.connect('activate', () => {
        // The JSON report format from weblate is a bit weird. Here we extract all
        // unique names from the translation report.
        const translators = new Set();
        this._getJSONResource('/credits/translators.json').forEach(i => {
          for (const j of Object.values(i)) {
            j.forEach(k => translators.add(k[1]));
          }
        });

        const dialog = new Adw.AboutWindow({transient_for: window, modal: true});
        dialog.set_application_icon('desktop-cube-symbolic');
        dialog.set_application_name('Desktop Cube');
        dialog.set_version(`${this.metadata.version}`);
        dialog.set_developer_name('Simon Schneegans');
        dialog.set_issue_url('https://github.com/Schneegans/Desktop-Cube/issues');
        dialog.set_translator_credits([...translators].join('\n'));
        dialog.set_copyright('© 2023 Simon Schneegans');
        dialog.set_website('https://github.com/Schneegans/Desktop-Cube');
        dialog.set_license_type(Gtk.License.GPL_3_0);

        dialog.show();
      });
      group.add_action(aboutAction);

      window.insert_action_group('prefs', group);
    });

    window.set_search_enabled(true);

    this._pages.forEach(page => {
      window.add(page);
    });

    // As we do not have something like a destructor, we just listen for the destroy
    // signal of our general page.
    this._pages[0].connect('destroy', () => {
      // Unregister our resources.
      Gio.resources_unregister(this._resources);
    });
  }


  // ----------------------------------------------------------------------- private stuff

  // Connects a DesktopCubeImageChooserButton (or anything else which has a 'file'
  // property) to a settings key. It also binds the corresponding reset button.
  _bindImageChooserButton(settingsKey) {
    this._bind(settingsKey, 'file');
  }

  // Connects a Gtk.Adjustment (or anything else which has a 'value' property) to a
  // settings key. It also binds the corresponding reset button.
  _bindAdjustment(settingsKey) {
    this._bind(settingsKey, 'value');
  }

  // Connects a Gtk.Switch (or anything else which has an 'active' property) to a settings
  // key. It also binds the corresponding reset button.
  _bindSwitch(settingsKey) {
    this._bind(settingsKey, 'active');
  }

  // Connects any widget's property to a settings key. The widget must have the same ID as
  // the settings key. It also binds the corresponding reset button.
  _bind(settingsKey, property) {
    this._settings.bind(settingsKey, this._builder.get_object(settingsKey), property,
                        Gio.SettingsBindFlags.DEFAULT);

    const resetButton = this._builder.get_object('reset-' + settingsKey);
    resetButton.connect('clicked', () => {
      this._settings.reset(settingsKey);
    });
  }

  // Reads the contents of a JSON file contained in the global resources archive. The data
  // is parsed and returned as a JavaScript object / array.
  _getJSONResource(path) {
    const data   = Gio.resources_lookup_data(path, 0);
    const string = new TextDecoder().decode(data.get_data());
    return JSON.parse(string);
  }

  // This traverses the widget tree below the given parent recursively and returns the
  // first widget of the given type.
  _findWidgetByType(parent, type) {
    for (const child of [...parent]) {
      if (child instanceof type) return child;

      const match = this._findWidgetByType(child, type);
      if (match) return match;
    }

    return null;
  }

  //////////////////////////////////////////////////////////////////////////////////////////
  // VR mode HMD related functions                                                        //
  //////////////////////////////////////////////////////////////////////////////////////////

  _vr_mode_set_openhmd_version(builder) {
    var hmd_version_openhmd_label = builder.get_object('hmd_version_openhmd');
    hmd_version_openhmd_label.set_text(GOpenHMD.version().to_string())
  }

  _vr_mode_context_enumerate(builder) {
    var hmd_dev_nums_label = builder.get_object('hmd_dev_nums');

    this.vr_mode_hmd_context = new GOpenHMD.Context();
    const enum_devs = this.vr_mode_hmd_context.enumerate();

    hmd_dev_nums_label.set_text(enum_devs.length.toString())

    var hmd_current_selected_row = builder.get_object('hmd_current_selected');
    var hmd_run_data_fetch_switcher = builder.get_object('hmd_run_data_fetch');

    var radiobutton_group;
    for (var i = 0; i < enum_devs.length; i++) {
      let title = `${enum_devs[i].vendor} ${enum_devs[i].product}`
      
      let row = new Adw.ActionRow();
      row.set_title(title);

      let path = enum_devs[i].path
      if (path) {
        row.set_subtitle(path);
      }

      if (i == 0) {
        // TODO: make selectors actual work
        hmd_current_selected_row.set_title(title);
        hmd_current_selected_row.icon_name = 'emblem-default-symbolic';
        var radiobtn = new Gtk.CheckButton();
        radiobutton_group = radiobtn;

        hmd_run_data_fetch_switcher.sensitive = true;

        this._vr_mode_configure_pose_fetch(builder, hmd_run_data_fetch_switcher, i);        
      } else {
        var radiobtn = new Gtk.CheckButton({group: radiobutton_group});
      }

      row.activatable_widget = radiobtn;
      row.add_suffix(radiobtn);
      
      hmd_current_selected_row.add_row(row)
    }
  }

  _vr_mode_configure_pose_fetch(builder, switcher, dev_index) {
    var hmd_fetch_quat_x_level = builder.get_object('hmd_fetch_quat_x');
    var hmd_fetch_quat_y_level = builder.get_object('hmd_fetch_quat_y');
    var hmd_fetch_quat_z_level = builder.get_object('hmd_fetch_quat_z');
    var hmd_fetch_quat_w_level = builder.get_object('hmd_fetch_quat_w');

    switcher.connect('notify::active', () => {
      if (switcher.get_active()) {
        let settings = new GOpenHMD.DeviceSettings(this.vr_mode_hmd_context);
        settings.set_automatic_update(true);
        this.active_fetch_device = this.vr_mode_hmd_context.open_device(dev_index, settings);
        this.vr_mode_hmd_poller = setInterval(() => {
          this.vr_mode_hmd_context.update();
          var quat = this.active_fetch_device.rotation_quat();
    
          hmd_fetch_quat_x_level.set_value(quat.x);
          hmd_fetch_quat_y_level.set_value(quat.y);
          hmd_fetch_quat_z_level.set_value(quat.z);
          hmd_fetch_quat_w_level.set_value(quat.w);
        }, 10);
      } else {
        this.active_fetch_device = null;
        clearInterval(this.vr_mode_hmd_poller);
      }
    });
  }

  _vr_mode_add_page(pages) {
    if (is_gopenhmd_available === true) {
      pages.push(this._builder.get_object('vr-page'))
      this._vr_mode_set_openhmd_version(this._builder);
      this._vr_mode_context_enumerate(this._builder);
    } else {
      let page = new Adw.PreferencesPage();
      let group = new Adw.PreferencesGroup();
      let vr_status = new Adw.StatusPage();

      vr_status.set_title('No library found');
      vr_status.set_description('GOpenHMD library required to operate with HMD');
      vr_status.set_icon_name('dialog-warning-symbolic');

      group.add(vr_status);
      page.add(group);

      page.icon_name = 'settings-vr-symbolic';
      page.title = 'VR';
      pages.push(page);
    }
  }

}
