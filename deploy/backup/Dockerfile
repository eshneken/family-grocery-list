FROM docker.io/library/postgres@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4
COPY check-trust.py /opt/check-trust.py
RUN apt-get update && apt-get install -y --no-install-recommends age python3 python3-venv ca-certificates \
    && python3 -m venv /opt/backup \
    && /opt/backup/bin/python -m pip install --no-cache-dir 'pip @ https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/pip-26.2.2-py3-none-any.whl#sha256=fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70' \
    && /opt/backup/bin/python -m pip install --no-cache-dir oci==2.180.0 'certifi>=2026.10.19' \
    && /opt/backup/bin/python -m pip check \
    && /opt/backup/bin/python /opt/check-trust.py \
    && rm -rf /var/lib/apt/lists/*
COPY backup.py /opt/backup/backup.py
USER 999:999
ENTRYPOINT ["/opt/backup/bin/python", "/opt/backup/backup.py"]
