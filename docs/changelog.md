# Changelog of the Desktop Cube Extension


## [Desktop Cube 9](https://github.com/schneegans/Desktop-Cube/releases/tag/v9)

**Release Date:** TBD

#### New Features

* **Skyboxes**: You can now set an image as background panorama! For best results, the image should be a 360° panorama in the equirectangular projection. A good source for such panoramas is [polyhaven.com/hdris](https://polyhaven.com/hdris). Be sure to download the tone-mapped JPEG versions!
* **Drag windows to adjacent workspaces**: You can now drag a window to the edge of your screen and with enough pressure, the cube will flip to the neighboring workspace! This works both, on the desktop and in the overview. There are two new switches in the preferences dialog to toggle these features.

#### Other Changes

* Removed the Liberapay donation option as it does not work properly.

## [Desktop Cube 8](https://github.com/schneegans/Desktop-Cube/releases/tag/v8)

**Release Date:** 2022-02-25

#### New Features

* It is now possible to **rotate the cube by single-click dragging**! This works in three places (all of them can be enabled or disabled in the settings):
  * In the **overview**: Click any non-interactive area (e.g. the background) and start dragging. You will be able to switch workspaces by horizontal movement, and you can look "into" the cube by rotating it up and down.
  * On the **desktop**: Simply click any free space on you desktop and start dragging the cube!
  * On the **panel**: Simply click on the panel and start dragging!
* **Cube Explosion**: If you rotate the cube vertically (both in desktop or overview mode), the cube will be scaled down and the depth separation between windows will be increased.
* **Depth Variance in Overview**: During rotations, window clones in the overview are not all drawn at the same depth.
* Proper **touch-screen support**: Rotating the cube works well on touch-screen devices. Especially the rotate-by-dragging-the-panel works very well in this case: Just slide a finger from the top edge of the screen and then rotate left and right!
* **Translations!** It is now possible to [translate the preferences dialog](https://hosted.weblate.org/engage/desktop-cube/). We already have those languages included (thanks to all the translators!):
  * Arabic
  * Dutch
  * English
  * French
  * German
  * Italian
  * Norwegian Bokmål
  * Spanish
* An **about-dialog** has been added which shows all translators and sponsors.
* Initial support for GNOME Shell 42. Please [report any bugs you find](https://github.com/Schneegans/Desktop-Cube/issues)!

#### Other Changes

* Removed the unfold-to-desktop option as we now have cuboid workspace transitions everywhere.
* **Added advanced CI tests:** For each commit to `main`, it is now tested whether the extension can be installed and if the preferences dialog can be shown on GNOME Shell 40 and 41. Both, X11 and Wayland are checked.
* The README now shows the current lines of code and the current comment percentage using my [dynamic-badges-action](https://github.com/Schneegans/dynamic-badges-action).
* Added [Liberapay](https://liberapay.com/Schneegans) to the sponsorship options.

#### Bug Fixes

* Fixed the workspace size in the overview. The active workspace should now be drawn at the same size as without the extension.
* Fixed some depth sorting issues. Especially when transitioning from window picker state to app drawer state, the windows were sometimes drawn behind the workspace backgrounds.
* Improved the performance of transition from overview to app-drawer.


## [Desktop Cube 7](https://github.com/schneegans/Desktop-Cube/releases/tag/v7)

**Release Date:** 2021-12-29

#### Bug Fixes

* Fixed cuboid desktop transitions when using touchpad gestures.

## [Desktop Cube 6](https://github.com/schneegans/Desktop-Cube/releases/tag/v6)

**Release Date:** 2021-12-29

#### New Features

* The transition between workspaces when switching in desktop mode now shows the "cube" as well.
* Added a menu to the preferences dialog with links for bug reporting and donations.

#### Other Enhancements

* The extension's version number is now shown in the title of the preferencs dialog.

#### Bug Fixes

* Fixed a non-critical warning about `-Infinity`.


## [Desktop Cube 5](https://github.com/schneegans/Desktop-Cube/releases/tag/v5)

**Release Date:** 2021-12-12

#### New Features

* A small settings dialog allows adjusting some settings regarding the cube's layout, appearance, and behavior.
* It's now possible re-enable the unfold-to-desktop animation.
* It's now possible to modify some animation times such as from desktop to overview, from overview to app drawer, and between workspaces.

## [Desktop Cube 4](https://github.com/schneegans/Desktop-Cube/releases/tag/v4)

**Release Date:** 2021-12-09

#### Enhancements

* The transition from desktop to overview does not fold / unfold the cube any more.
* Cube-face-position computations has been refactored. There are now constants in the code to reliably specify the gap between adjacent workspaces as well as to stretch the position of the next and previous workspace horizontally. This ensures that the side faces of a four-sided cube are visible from the front.
* This changelog has been added.

#### Bug Fixes
* Fixed overlapping workspaces if there are many workspaces.


## [Desktop Cube 3](https://github.com/schneegans/Desktop-Cube/releases/tag/v3)

**Release Date:** 2021-12-07

* Support for GNOME 41 has been added.



## [Desktop Cube 2](https://github.com/schneegans/Desktop-Cube/releases/tag/v2)

**Release Date:** 2021-12-07

* Re-licensed the code as GPLv3 as this is a requirement for invasive GNOME Shell extensions.


## [Desktop Cube 1](https://github.com/schneegans/Desktop-Cube/releases/tag/v1)

**Release Date:** 2021-12-07

* Initial publication on GitHub supporting GNOME 40.
