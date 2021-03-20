FROM node:14

COPY . /usr/src/app

WORKDIR /usr/src/app

RUN \
  sh fullinstall-ci.sh && \
  chown node:node logs persist
  #sh fullinstall-prod.sh

USER node

VOLUME ["/usr/src/app/logs", "/usr/src/app/persist"]

CMD node nocto.js
