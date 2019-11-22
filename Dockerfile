FROM node:12

RUN mkdir /app
WORKDIR /app
COPY . .
RUN mkdir logs
RUN npm install --production

VOLUME /app/persist

CMD ["npm", "start"]
