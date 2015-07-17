npm install
for plugindir in plugins/*
do
    ( cd "$plugindir" && npm install )
done
