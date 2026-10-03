"""Durable local handoff to Electron; event IDs survive retries and Python restarts."""
import json
import os
import sqlite3
import uuid
from pathlib import Path
import requests


def spool_path():
    directory = os.environ.get('AI_SPOOL_DIR') or str(Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'IntegrityFlow' / 'python-alerts')
    return Path(directory) / 'pending.sqlite3'


def _connect(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=5)
    connection.execute('CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
    return connection


def enqueue(payload, path=None):
    payload.setdefault('eventId', str(uuid.uuid4()))
    connection = _connect(path or spool_path())
    try:
        with connection:
            connection.execute('INSERT OR IGNORE INTO alerts VALUES (?, ?)',
                               (payload['eventId'], json.dumps(payload, allow_nan=False)))
    finally:
        connection.close()


def deliver_one(url, path=None):
    """Remove only after Electron acknowledges durable acceptance; errors retain the row."""
    connection = _connect(path or spool_path())
    try:
        row = connection.execute('SELECT id, payload FROM alerts ORDER BY rowid LIMIT 1').fetchone()
        if row is None:
            return False
        response = requests.post(url, json=json.loads(row[1]), timeout=5)
        response.raise_for_status()
        if response.json().get('status') != 'accepted':
            raise RuntimeError('Electron did not acknowledge durable alert storage')
        with connection:
            connection.execute('DELETE FROM alerts WHERE id = ?', (row[0],))
        return True
    finally:
        connection.close()
