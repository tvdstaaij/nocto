#!/bin/sh
npm install
for plugindir in plugins/*
do
    ( cd "$plugindir" 2>/dev/null && [ -f package.json ] && npm install )
done
