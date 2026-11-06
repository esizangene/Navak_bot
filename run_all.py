import os
import subprocess
import sys
import time

PROGRAMS = [
    ("bot.py", "TELEGRAM_BOT_TOKEN"),
    ("bale_bot.py", "BALE_BOT_TOKEN"),
    ("rubika_bot.py", "RUBIKA_BOT_TOKEN"),
]


def main():
    enabled = [(program, token) for program, token in PROGRAMS
               if os.getenv(token, "").strip()]
    if not enabled:
        raise SystemExit("Set at least one bot token in the hosting environment.")

    processes = []
    for program, _ in enabled:
        processes.append((program, subprocess.Popen([sys.executable, program])))

    try:
        while True:
            for program, process in processes:
                code = process.poll()
                if code is not None:
                    raise SystemExit(f"{program} stopped with exit code {code}")
            time.sleep(5)
    finally:
        for _, process in processes:
            if process.poll() is None:
                process.terminate()
        for _, process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
