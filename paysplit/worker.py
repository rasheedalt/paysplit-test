"""Run payout queue once or continuously on a one-minute schedule."""
import argparse
import time
from .core import init_db, process_pending


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    init_db()
    while True:
        count = process_pending()
        print(f"Processed {count} allocations", flush=True)
        if args.once:
            break
        time.sleep(60)


if __name__ == "__main__":
    main()
