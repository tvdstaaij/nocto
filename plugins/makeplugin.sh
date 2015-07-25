#!/usr/bin/env bash
if [ -z "$1" ]; then
    echo "Usage: makeplugin.sh pluginname"
    exit 1
fi

skel=".skeleton"
cd "${0%/*}" # Make this directory (plugins) the working directory
mkdir "$1"
sed "s/$skel/$1/g" $skel/package.json >  "$1/package.json"
cat $skel/script.js > "$1/$1.js"
cat $skel/config.json > "$1/config.json"
