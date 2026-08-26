#!/usr/bin/env python3
"""
Resolve the hosted database connection string.

Supabase's Connect dialog gives the pooled string with a literal
[YOUR-PASSWORD] placeholder. Filling it in by hand is the failure everyone
hits: a password containing @ : / ? # or & corrupts the URL, and a rotated
password leaves the previous one embedded. Postgres reports both the same way —
"password authentication failed" — which points at the wrong cause.

Paste the string verbatim and let this substitute SUPABASE_DB_PASSWORD with
correct percent-encoding.

Prints the resolved URL to stdout, or with --describe prints only the
non-secret parts so a log can show what was targeted.
"""
import os
import re
import sys
import urllib.parse

PLACEHOLDER = re.compile(r"\[YOUR-PASSWORD\]|\[password\]", re.IGNORECASE)


def resolve() -> str:
    url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not url:
        sys.exit("SUPABASE_DB_URL is not set.")

    if PLACEHOLDER.search(url):
        password = os.environ.get("SUPABASE_DB_PASSWORD", "")
        if not password:
            sys.exit(
                "SUPABASE_DB_URL still contains a password placeholder, but "
                "SUPABASE_DB_PASSWORD is empty. Set it, or paste a URL with the "
                "password already filled in."
            )
        url = PLACEHOLDER.sub(urllib.parse.quote(password, safe=""), url)

    parsed = urllib.parse.urlparse(url)
    if not parsed.hostname:
        sys.exit("SUPABASE_DB_URL is not a valid connection string — no host parsed.")
    if not parsed.password:
        sys.exit(
            "SUPABASE_DB_URL carries no password. Copy the pooled string from the "
            "project's Connect dialog, keeping the [YOUR-PASSWORD] placeholder."
        )
    return url


def main() -> None:
    url = resolve()

    if "--describe" in sys.argv:
        parsed = urllib.parse.urlparse(url)
        print(f"host: {parsed.hostname}")
        print(f"user: {parsed.username}")
        print(f"port: {parsed.port}")
        # Never the password, not even its length.
        return

    print(url)


if __name__ == "__main__":
    main()
