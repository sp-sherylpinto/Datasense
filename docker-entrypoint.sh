#!/bin/sh
# Fix volume directory permissions so appuser can write
chown -R appuser:appuser /data 2>/dev/null || true
# Drop privileges and exec the main process
exec gosu appuser "$@"
