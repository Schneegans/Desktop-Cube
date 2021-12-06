//////////////////////////////////////////////////////////////////////////////////////////
// ,-.  ,--.  ,-.  ,  , ,---.  ,-.  ;-.     ,-. .  . ,-.  ,--. This software may be     //
// |  \ |    (   ` | /    |   /   \ |  )   /    |  | |  ) |    modified and distributed //
// |  | |-    `-.  |<     |   |   | |-'    |    |  | |-<  |-   under the MIT license.   //
// |  / |    .   ) | \    |   \   / |      \    |  | |  ) |    See the LICENSE file     //
// `-'  `--'  `-'  '  `   '    `-'  '       `-' `--` `-'  `--' for details.             //
//////////////////////////////////////////////////////////////////////////////////////////

'use strict';

const ExtensionUtils = imports.misc.extensionUtils;
const Me             = imports.misc.extensionUtils.getCurrentExtension();

// This method can be used to write a message to GNOME Shell's log. This is enhances
// the standard log() functionality by prepending the extension's name and the location
// where the message was logged. As the extensions name is part of the location, you
// can more effectively watch the log output of GNOME Shell:
// journalctl -f -o cat | grep -E 'desktop-cube|'
function debug(message) {
  const stack = new Error().stack.split('\n');

  // Remove debug() function call from stack.
  stack.shift();

  // Find the index of the extension directory (e.g. desktopcube@schneegans.github.com)
  // in the stack entry. We do not want to print the entire absolute file path.
  const extensionRoot = stack[0].indexOf(Me.metadata.uuid);

  log('[' + stack[0].slice(extensionRoot) + '] ' + message);
}
