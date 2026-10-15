import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path


COORDINATE = re.compile(r"^\s+([^:\s]+):([^:\s]+):jar:([^:\s]+):(?:compile|runtime)(?:\s|$)")
ENDPOINT = "https://api.osv.dev/v1/querybatch"


def audit(inventory):
    queries = []
    for line in inventory.read_text(encoding="utf-8").splitlines():
        match = COORDINATE.match(line)
        if match:
            group, artifact, version = match.groups()
            queries.append({"package": {"ecosystem": "Maven", "name": f"{group}:{artifact}"}, "version": version})
    if not queries:
        raise ValueError("the Maven runtime dependency inventory is empty")
    findings = set()
    pending = queries
    while pending:
        request = urllib.request.Request(
            ENDPOINT,
            data=json.dumps({"queries": pending}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            results = json.load(response)["results"]
        if len(results) != len(pending):
            raise ValueError("OSV returned an incomplete dependency scan")
        following = []
        for query, result in zip(pending, results):
            for vulnerability in result.get("vulns", []):
                findings.add((query["package"]["name"], query["version"], vulnerability["id"]))
            if result.get("next_page_token"):
                following.append({**query, "page_token": result["next_page_token"]})
        pending = following
    print(f"Checked {len(queries)} Maven runtime dependencies against OSV.")
    for name, version, advisory in sorted(findings):
        print(f"{name}:{version}: https://osv.dev/vulnerability/{advisory}", file=sys.stderr)
    if findings:
        raise ValueError(f"found {len(findings)} dependency/advisory matches")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Audit a Maven dependency:list runtime inventory against OSV.")
    parser.add_argument("inventory", type=Path)
    args = parser.parse_args()
    try:
        audit(args.inventory)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Dependency audit failed: {error}", file=sys.stderr)
        sys.exit(1)
