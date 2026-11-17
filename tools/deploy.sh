#!/usr/bin/env bash
# Publishes the site. Run inside the git clone after committing to main.
# main holds everything; the gh-pages branch holds only the contents of docs/ and is what
# GitHub Pages serves at arena.capmon.fun.
set -euo pipefail
git -c push.negotiate=true push origin main
git push --force origin "$(git subtree split --prefix docs main):refs/heads/gh-pages"
echo "pushed. Live in about a minute at https://arena.capmon.fun"
