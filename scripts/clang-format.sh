#!/bin/bash

# ---------------------------------------------------------------------------------------#
#  ,-.  ,--.  ,-.  ,  , ,---.  ,-.  ;-.     ,-. .  . ,-.  ,--. This software may be      #
#  |  \ |    (   ` | /    |   /   \ |  )   /    |  | |  ) |    modified and distributed  #
#  |  | |-    `-.  |<     |   |   | |-'    |    |  | |-<  |-   under the MIT license.    #
#  |  / |    .   ) | \    |   \   / |      \    |  | |  ) |    See the LICENSE file      #
#  `-'  `--'  `-'  '  `   '    `-'  '       `-' `--` `-'  `--' for details.              #
# ---------------------------------------------------------------------------------------#

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
