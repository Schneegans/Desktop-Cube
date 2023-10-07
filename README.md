<!--
SPDX-FileCopyrightText: Simon Schneegans <code@simonschneegans.de>
SPDX-License-Identifier: CC-BY-4.0
-->

<p align="center">
  <a href="https://www.youtube.com/watch?v=J7pdnkv7v1A"><img src ="docs/pics/teaser.jpg" /></a>
</p>

<h1 align="center">A Desktop Cube for GNOME Shell</h1>

<p align="center">
  <a href="https://extensions.gnome.org/extension/4648/desktop-cube/"><img src="https://img.shields.io/badge/Download-extensions.gnome.org-e67f4d.svg?logo=gnome&logoColor=lightgrey&labelColor=303030" /></a><br/>
  <a href="https://github.com/Schneegans/Desktop-Cube/actions"><img src="https://github.com/Schneegans/Desktop-Cube/workflows/Checks/badge.svg?branch=main" /></a>
  <a href="https://api.reuse.software/info/github.com/Schneegans/Desktop-Cube"><img src="https://api.reuse.software/badge/github.com/Schneegans/Desktop-Cube" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-blue.svg?labelColor=303030" /></a>
  <a href="https://hosted.weblate.org/engage/desktop-cube/"><img src="https://img.shields.io/weblate/progress/desktop-cube?label=Translated&logo=weblate&logoColor=lightgray&labelColor=303030" /></a>
  <a href="scripts/cloc.sh"><img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/Schneegans/66479de801ea8e0f6a1cf084cd37ffe8/raw/loc.json" /></a>
  <a href="scripts/cloc.sh"><img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/Schneegans/66479de801ea8e0f6a1cf084cd37ffe8/raw/comments.json" /></a>
</p>

**:warning: The code in the `main` branch is for GNOME Shell 45+. For older GNOME versions, please use the `gnome-40-41` or `gnome-42-44` branches respectively.**

When I started using Linux more than a decade ago, it was because of the 3D desktop cube of Compiz.
Even if this was a pretty useless feature, I am still missing it today.
Therefore, I decided to create a similar effect for GNOME Shell.
If you like it, you may also be interested in other nostalgic extensions, such as [Compiz windows effects](https://extensions.gnome.org/extension/3210/compiz-windows-effect/), or [Burn-My-Windows](https://extensions.gnome.org/extension/4679/burn-my-windows/)!

For a list of things changed in previous releases, you can have a look at the [changelog](docs/changelog.md)!

## 🎉 Features

|                 ![feature01](docs/pics/feature01.gif) <br> **3D Overview:** The extension arranges the workspaces in the overview in a cube-like fashion.                 |                ![feature02](docs/pics/feature02.gif) <br> **3D Workspaces:** Also, when switching workspaces with touch gestures or keyboard shortcuts, the cube is shown.                 |
| :-----------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| ![feature03](docs/pics/feature03.gif) <br> **Click and drag the desktop to rotate the cube:** You can click and drag anywhere on the desktop to start rotating the cube!  | ![feature04](docs/pics/feature04.gif) <br> **Click and drag the panel to rotate the cube:** You can also trigger the cube by dragging on the panel. This is useful with maximized windows. |
| ![feature05](docs/pics/feature05.gif) <br> **Click and drag the overview to rotate the cube:** You can also click and drag the overview's background to rotate the cube.  |             ![feature06](docs/pics/feature06.gif) <br> **Explode the cube on vertical rotations:** If you rotate the cube up or down, the 3D effect will become more intense.              |
| ![feature07](docs/pics/feature07.gif) <br> **Smooth transitions between Desktop, Overview, and App Drawer:** If you enter the app-drawer mode, the cube will be unfolded. |            ![feature08](docs/pics/feature08.gif) <br> **Dynamic workspaces:** The extension supports any number of workspaces. So it's actually not a cube most of the time...             |
|                      ![feature09](docs/pics/feature09.gif) <br> **Background panoramas:** You can select an image which will be used as 360° skybox.                      |          ![feature10](docs/pics/feature10.gif) <br> **Drag windows to other workspaces:** You can directly drag windows to adjacent workspaces. This also works in the overview.           |

## 🪲 Limitations

Issues are tracked [here on GitHub](https://github.com/Schneegans/Desktop-Cube/issues). There are currently two main known limitations:

- **No wrap-around:** In GNOME Shell, it is not possible to change from the last to the first workspace. The Desktop-Cube extension does not change this.
- **Bad multi-monitor support on X11:** On X11, GNOME Shell uses the same projection and view matrices for all monitors. The extension can modify these matrices so that the projection center of the virtual camera is in front of the current monitor. However, the cube looks somewhat sheared on setups with multiple monitors if the cube is shown on all monitors.

## 💞 Show that you love the Desktop Cube!

While coding new features or translating the Desktop Cube is the most awesome way to contribute, [providing financial support](https://schneegans.github.io/sponsors/) will encourage me to invest my spare time for developing free and open-source software.

These awesome people have already donated to the development of my open-source projects:

[![Sponsors](https://schneegans.github.io/sponsors/sponsors.svg)](https://schneegans.github.io/sponsors/)

Do you want to show that you love it too? If you donate via [Ko-fi](https://ko-fi.com/schneegans), [GitHub](https://github.com/sponsors/Schneegans), or [PayPal](https://www.paypal.com/donate/?hosted_button_id=3F7UFL8KLVPXE), you will show up in this list as well!

## ⬇️ Installation

You can either install the Desktop Cube extension from extensions.gnome.org (a), download a stable release
from GitHub (b) or clone the latest version directly with `git` (c).

### a) Installing from extensions.gnome.org

This is the easiest way to install the Desktop Cube extension. Just head over to
[extensions.gnome.org](https://extensions.gnome.org/extension/4648/desktop-cube) and flip the switch!
If you want to use a more up-to-date version, you can try one of the methods listed below.

### b) Downloading a Stable Release

Execute this command to download the latest stable release:

```bash
wget https://github.com/Schneegans/Desktop-Cube/releases/latest/download/desktop-cube@schneegans.github.com.zip
```

Install it by executing the following command. If you have the Desktop Cube extension already installed and want to upgrade to
the latest version, append the `--force` flag in order to overwrite existing installs of the Desktop Cube extension.

```bash
gnome-extensions install desktop-cube@schneegans.github.com.zip
```

Then restart GNOME Shell with <kbd>Alt</kbd> + <kbd>F2</kbd>, <kbd>r</kbd> + <kbd>Enter</kbd>.
Or logout / login if you are on Wayland.
Then you can enable the extension with the _Gnome Tweak Tool_, the _Extensions_ application or with this command:

```bash
gnome-extensions enable desktop-cube@schneegans.github.com
```

### c) Cloning the Latest Version with `git`

You should **not** clone the Desktop Cube extension directly to the `~/.local/share/gnome-shell/extensions` directory as this may get overridden occasionally!
Execute the clone command below where you want to have the source code of the extension.

```bash
git clone https://github.com/Schneegans/Desktop-Cube.git
cd Desktop-Cube
```

If your GNOME Shell version is <= 45, you will have to checkout the `gnome-42-44` branch:

```bash
git checkout gnome-42-44
```

Now you will have to install the extension.
The `make` command below compiles the locales, schemas and resources, creates a zip file of the extension and finally installs it with the `gnome-extensions` tool.

```bash
make install
```

Then restart GNOME Shell with <kbd>Alt</kbd> + <kbd>F2</kbd>, <kbd>r</kbd> + <kbd>Enter</kbd>.
Or logout / login if you are on Wayland.
Then you can enable the extension with the _Gnome Tweak Tool_, the _Extensions_ application or with this command:

```bash
gnome-extensions enable desktop-cube@schneegans.github.com
```

## :octocat: I want to contribute!

That's great!
Here are some basic rules to get you started:
Commits should start with a Capital letter and should be written in present tense (e.g. **:tada: Add cool new feature** instead of **:tada: Added cool new feature**).
You should also start your commit message with **one** applicable emoji.
This does not only look great but also makes you rethink what to add to a commit. Make many but small commits!

| Emoji                                                     | Description                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| :tada: `:tada:`                                           | When you added a cool new feature.                                        |
| :wrench: `:wrench:`                                       | When you added a piece of code.                                           |
| :recycle: `:recycle:`                                     | When you refactored a part of the code.                                   |
| :sparkles: `:sparkles:`                                   | When you applied clang-format.                                            |
| :globe_with_meridians: `:globe_with_meridians:`           | When you worked on translations.                                          |
| :art: `:art:`                                             | When you improved / added assets like themes.                             |
| :lipstick: `:lipstick:`                                   | When you worked on the UI of the preferences dialog.                      |
| :rocket: `:rocket:`                                       | When you improved performance.                                            |
| :memo: `:memo:`                                           | When you wrote documentation.                                             |
| :beetle: `:beetle:`                                       | When you fixed a bug.                                                     |
| :revolving_hearts: `:revolving_hearts:`                   | When a new sponsor is added or credits are updated.                       |
| :heavy_check_mark: `:heavy_check_mark:`                   | When you worked on checks or adjusted the code to be compliant with them. |
| :twisted_rightwards_arrows: `:twisted_rightwards_arrows:` | When you merged a branch.                                                 |
| :fire: `:fire:`                                           | When you removed something.                                               |
| :truck: `:truck:`                                         | When you moved / renamed something.                                       |
