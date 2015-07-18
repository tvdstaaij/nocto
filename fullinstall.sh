#!/usr/bin/env bash
npm install
for plugindir in plugins/*
do
    ( cd "$plugindir" && [ -f package.json ] && npm install )
done
