#!/bin/sh
npm ci
for plugindir in plugins/*
do
    ( cd "$plugindir" 2>/dev/null && [ -f package-lock.json ] && npm ci )
done
