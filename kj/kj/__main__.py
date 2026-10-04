import argparse
import dataclasses
import json
import logging

from kj.auth import sign_in
from kj.browser import open_context
from kj.client import KijijiClient
from kj.config import load_config


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kj")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("login")
    search = commands.add_parser("search")
    search.add_argument("keywords", nargs="?", default="")
    search.add_argument("--category", type=int)
    search.add_argument("--location", type=int, default=0)
    search.add_argument("--page", type=int, default=1)
    listing = commands.add_parser("listing")
    listing.add_argument("id_or_url")
    return parser


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args()
    config = load_config()
    with open_context(config) as context:
        if args.command == "login":
            sign_in(context, config)
            print("signed in")
            return
        client = KijijiClient(context)
        if args.command == "search":
            result = client.search(args.keywords, args.category, args.location, args.page)
            print(json.dumps(dataclasses.asdict(result), indent=2))
            return
        print(json.dumps(dataclasses.asdict(client.get_listing(args.id_or_url)), indent=2))


main()
