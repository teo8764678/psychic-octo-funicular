FROM ubuntu:latest

# Cài đặt các gói cần thiết
RUN apt update && apt upgrade -y && apt-get install -y \
    htop \
    curl \
    ca-certificates \
    git \
    sudo \
    unzip \
    wget \
    python3

# Khi container start thì chạy script sshx luôn
RUN curl -sSf https://sshx.io/get | sh -s run 
