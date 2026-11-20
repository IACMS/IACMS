#!/bin/bash
# This script kills all stranded root-owned docker proxies and orphaned processes.
echo "Attempting to kill stranded processes. You will be prompted for your sudo password."
sudo pkill docker-proxy
sudo pkill -u 70
echo "Done! Process cleanup complete. You can now safely run ./start_services_sequentially.sh"
