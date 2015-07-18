#!/usr/bin/env bash
if [ -z "$1" ]; then
    echo "Usage: makeplugin.sh pluginname"
    exit 1
fi

cd "${0%/*}" # Make this directory (plugins) the working directory
mkdir "$1"
sed "s/skeleton/$1/g" skeleton/package.json >  "$1/package.json"
cat skeleton/script.js > "$1/$1.js"
cat skeleton/config.json > "$1/config.json"
