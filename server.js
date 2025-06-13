const http = require('http');

const server = http.createServer((req, res) => {
  res.end('Nail Shop Bot is running!');
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('Server is listening on port 3000');
});