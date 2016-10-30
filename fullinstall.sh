#!/usr/bin/env bash
npm install --production
for plugindir in plugins/*
do
    ( cd "$plugindir" 2>/dev/null && [ -f package.json ] && npm install --production )
done
