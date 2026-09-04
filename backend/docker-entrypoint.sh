#!/bin/sh
set -eu

# Railway volumes are mounted after the image is built and initially belong to
# root. Prepare the upload tree on every boot, then run the application without
# root privileges.
if [ "$(id -u)" = "0" ]; then
    mkdir -p /app/uploads/jd /app/uploads/resumes /app/uploads/attachments
    chown -R app:app /app/uploads
    exec setpriv --reuid=app --regid=app --init-groups -- "$@"
fi

mkdir -p /app/uploads/jd /app/uploads/resumes /app/uploads/attachments
exec "$@"
