<p align="center">
  <img src ="docs/pics/teaser.gif" />
</p>

# Desktop Cube for GNOME Shell

When I started using Linux more than a decade ago, it was because of the 3D desktop cube of Compiz.

## :construction: This is under Construction!

Here's a rough list of thing which might be added in the future:

- [ ] Support for GNOME Shell 41.
- [ ] A settings dialog. The opacity of the workspaces, their spacing, and several other things could be configurable.
- [ ] Better transitions. I would like to improve the impression of "folding".
- [ ] Proper support for multiple monitors (it may work already, I just haven't tested it).
- [ ] Cuboid transitions when switching workspaces via <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Arrow</kbd>.
- [ ] Automated CI tests.


## :exploding_head: Frequently asked Questions

#### Does this extension increase my productivity?

No.

#### Does this extension increase the performance of GNOME Shell?

Certainly not. But the impact is not so bad after all.

#### Will this extension break if GNOME Shell is updated?

Most likely. The implementation is pretty hacky and relies on some specific internals of GNOME Shell. But maybe we will be able to keep it running....

#### The workspaces are not really arranged in a cuboid fashion. Should we change the name of the extension?

That's a smart point! However, covering only 180°, ensures that no one notices that we cannot rotate the "cube" an entire round...
