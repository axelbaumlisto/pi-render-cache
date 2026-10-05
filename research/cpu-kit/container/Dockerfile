FROM node:22-slim

# util-linux даёт script (нужен настоящий псевдотерминал), python3 — для разбора замеров
RUN apt-get update && apt-get install -y --no-install-recommends \
      util-linux procps python3 ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

ARG PI_VERSION=1.0.2
RUN npm install -g @earendil-works/pi-coding-agent@${PI_VERSION} \
    && pi --version

WORKDIR /work
COPY probes /opt/probes
COPY bench.sh /opt/bench.sh
ENV HOME=/root TERM=xterm-256color
ENTRYPOINT ["bash", "/opt/bench.sh"]
