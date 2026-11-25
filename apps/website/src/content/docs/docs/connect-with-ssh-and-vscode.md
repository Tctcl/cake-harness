---
title: Connect with SSH and VS Code
description: Configure SSH access to a Cake workspace and open it with VS Code Remote-SSH.
---

Cake gives each workspace container a stable SSH port and a persistent host identity. SSH uses public-key authentication only. Your private key stays on your computer; Cake stores only public keys.

## 1. Add an SSH key

Open **Settings → SSH keys**. Upload an existing OpenSSH public key, or choose **Generate a key**. Cake displays a generated private key once and offers a download named `cake_ed25519`; save it in `~/.ssh` and keep it private. Cake does not retain generated private keys.

The owner’s public keys are authorized in all of their workspace containers. New keys are applied to running containers immediately and to stopped containers the next time they start. Removing a key revokes it from running containers.

## 2. Add the SSH configuration

Open the workspace’s **Environment** tab and copy the SSH config block into `~/.ssh/config`. The block includes that workspace’s unique `cake-<slug>` alias, public host, allocated port, user, and identity file. Change the **Identity file path** field if you use a different local filename; Cake remembers the path in this browser.

You can test the connection from a terminal with the displayed `ssh cake-<slug>` command. The first connection may ask you to trust the container’s host key.

## 3. Open in VS Code

Install Microsoft’s **Remote - SSH** extension, then select **Open in VS Code** in the Environment tab. VS Code connects to `/home/dev/workspace`. The workspace home and SSH host keys persist across container recreation.

The Environment tab lists listening TCP ports. Use the displayed `ssh -N -L <port>:localhost:<port> cake-<slug>` command for a manual forward. VS Code detects and forwards development-server ports automatically.

## Server firewall

The default SSH range is `22000-22999/tcp`. The installer defaults `CAKE_SSH_HOST` to the install’s `DOMAIN`; configure DNS and open the full port range on that host. `CAKE_SSH_PORT_RANGE` can be narrowed or changed, but the entire configured range must be reachable by SSH clients. Development-server ports themselves are never published on the host.
