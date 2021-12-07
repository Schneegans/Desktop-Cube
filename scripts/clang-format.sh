#!/bin/bash

# -------------------------------------------------------------------------------------- #
#  ,-.  ,--.  ,-.  ,  , ,---.  ,-.  ;-.     ,-. .  . ,-.  ,--. This software may be      #
#  |  \ |    (   ` | /    |   /   \ |  )   /    |  | |  ) |    modified and distributed  #
#  |  | |-    `-.  |<     |   |   | |-'    |    |  | |-<  |-   under the GPLv3 or        #
#  |  / |    .   ) | \    |   \   / |      \    |  | |  ) |    later. See the LICENSE    #
#  `-'  `--'  `-'  '  `   '    `-'  '       `-' `--` `-'  `--' file for details.         #
# -------------------------------------------------------------------------------------- #

# This script is based on a similar script from the Fly-Pie GNOME Shell extension which is
# published under the MIT License (https://github.com/Schneegans/Fly-Pie).

# Exit the script when one command fails.
set -e

# Go to the repo root.
cd "$( cd "$( dirname "$0" )" && pwd )/.." || \
  { echo "ERROR: Could not find the repo root."; exit 1; }

# Execute clang format for all *.js files.
find . -type f -name '*.js' -exec sh -c '
  for file do
    echo "Formatting $file..."
    clang-format -i "$file"
  done
' sh {} +
