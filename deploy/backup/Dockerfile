FROM docker.io/library/postgres@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4
RUN apt-get update && apt-get install -y --no-install-recommends age python3 python3-venv ca-certificates \
    && python3 -m venv /opt/backup \
    && /opt/backup/bin/pip install --no-cache-dir oci==2.180.0 \
    && rm -rf /var/lib/apt/lists/*
COPY backup.py /opt/backup/backup.py
USER 999:999
ENTRYPOINT ["/opt/backup/bin/python", "/opt/backup/backup.py"]
