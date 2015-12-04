#!/usr/bin/env bash
npm install --production
for plugindir in plugins/*
do
    ( cd "$plugindir" && [ -f package.json ] && npm install --production )
done
