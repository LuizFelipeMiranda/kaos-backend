const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["https://kaos-frontend-mocha.vercel.app", "http://localhost:5173"], 
    methods: ["GET", "POST"]
  }
});

function criarBaralho() {
  const cores = ['vermelho', 'azul', 'verde', 'amarelo'];
  const valores = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'bloqueio', 'inverter', '+2'];
  let baralho = [];

  cores.forEach(cor => {
    valores.forEach(valor => {
      baralho.push({ id: Math.random().toString(36).substring(2, 10), cor, valor });
      if (valor !== '0') {
        baralho.push({ id: Math.random().toString(36).substring(2, 10), cor, valor });
      }
    });
  });

  for (let i = 0; i < 4; i++) {
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'coringa' });
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: '+4' });
  }

  for (let i = baralho.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [baralho[i], baralho[j]] = [baralho[j], baralho[i]];
  }

  return baralho;
}

function validarSequencia(cartas) {
  if (cartas.length === 1) return true;
  const mesmoValor = cartas.every(c => c.valor === cartas[0].valor);
  if (mesmoValor) return true;

  const todosSaoNumeros = cartas.every(c => !isNaN(c.valor));
  if (todosSaoNumeros) {
    const mesmaCor = cartas.every(c => c.cor === cartas[0].cor);
    if (mesmaCor) {
      const crescente = cartas.every((c, i) => {
        if (i === 0) return true;
        return parseInt(c.valor) === parseInt(cartas[i - 1].valor) + 1;
      });
      if (crescente) return true;
    }
  }
  return false;
}

const salas = {};

io.on('connection', (socket) => {
  console.log(`🟢 Um jogador se conectou! ID: ${socket.id}`);

  const obterInfoJogadores = (sala) => {
    return sala.jogadores.map(j => ({
      id: j.id,
      nome: j.nome,
      avatar: j.avatar,
      qtdCartas: j.mao ? j.mao.length : 0
    }));
  };

  socket.on('criar_sala', ({ nomeJogador, avatar }) => {
    const codigoSala = Math.floor(1000 + Math.random() * 9000).toString();
    salas[codigoSala] = {
      id: codigoSala,
      status: 'esperando',
      jogadores: [{ id: socket.id, nome: nomeJogador, avatar }]
    };
    socket.join(codigoSala);
    socket.emit('sala_criada', codigoSala);
  });

  socket.on('entrar_sala', ({ codigoSala, nomeJogador, avatar }) => {
    if (salas[codigoSala]) {
      if (salas[codigoSala].status === 'jogando') {
        socket.emit('erro', 'A partida já começou! Não é possível entrar agora.');
        return;
      }

      if (salas[codigoSala].jogadores.length >= 6) {
        socket.emit('erro', 'A sala está cheia (máximo de 6 jogadores).');
        return;
      }
      
      salas[codigoSala].jogadores.push({ id: socket.id, nome: nomeJogador, avatar });
      socket.join(codigoSala);
      
      io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(salas[codigoSala]));
      socket.emit('entrou_na_sala', codigoSala);
    } else {
      socket.emit('erro', 'Código da sala não encontrado!');
    }
  });

  socket.on('iniciar_partida', (codigoSala) => {
    const sala = salas[codigoSala];
    
    if (sala && sala.jogadores[0].id === socket.id) {
      sala.status = 'jogando';
      sala.baralho = criarBaralho();
      sala.mesa = [];

      sala.jogadores.forEach(jogador => {
        jogador.mao = sala.baralho.splice(0, 7);
        jogador.disseUno = false; 
      });

      // === NOVA REGRA DE INÍCIO ===
      // Procura no baralho a primeira carta que seja um NÚMERO (!isNaN) e NÃO SEJA PRETA
      const indexCartaValida = sala.baralho.findIndex(c => !isNaN(c.valor) && c.cor !== 'preto');
      // Remove a carta encontrada do baralho e define como carta do topo
      let cartaTopo = sala.baralho.splice(indexCartaValida, 1)[0];
      
      sala.mesa.push(cartaTopo);
      sala.turnoIndex = 0;
      sala.sentido = 1;
      sala.comprouNestaRodada = false;
      sala.comprasAcumuladas = 0;
      sala.eventoBateMesa = { ativo: false, jogadoresQueBateram: [], punicao: 0 };

      sala.jogadores.forEach(jogador => {
        io.to(jogador.id).emit('partida_iniciada', {
          minhaMao: jogador.mao,
          cartaMesa: cartaTopo,
          turnoAtual: sala.jogadores[sala.turnoIndex].id,
          sentido: sala.sentido,
          comprouNestaRodada: sala.comprouNestaRodada,
          comprasAcumuladas: sala.comprasAcumuladas,
          infoJogadores: obterInfoJogadores(sala)
        });
      });
    }
  });

  socket.on('jogar_cartas', ({ codigoSala, cartas, novaCor, alvoTroca }) => {
    const sala = salas[codigoSala];
    if (!sala || sala.status !== 'jogando') return;

    const jogadorAtual = sala.jogadores[sala.turnoIndex];
    if (jogadorAtual.id !== socket.id) return;

    const cartaMesa = sala.mesa[sala.mesa.length - 1];
    const primeiraCarta = cartas[0];
    const isPrimeiraCoringa = primeiraCarta.cor === 'preto';
    const combinaComMesa = isPrimeiraCoringa || primeiraCarta.cor === cartaMesa.cor || primeiraCarta.valor === cartaMesa.valor;

    if (!combinaComMesa) {
      socket.emit('erro', 'A primeira carta escolhida não combina com a mesa!');
      return;
    }

    if (sala.comprasAcumuladas > 0) {
      if (primeiraCarta.valor !== '+2' && primeiraCarta.valor !== '+4') {
        socket.emit('erro', `Jogue um +2/+4 para passar o acúmulo adiante ou compre ${sala.comprasAcumuladas} cartas.`);
        return;
      }
    }

    if (!validarSequencia(cartas)) {
      socket.emit('erro', 'Sequência inválida! Use cartas iguais ou números crescentes da mesma cor.');
      return;
    }

    cartas.forEach(cartaJogada => {
      const index = jogadorAtual.mao.findIndex(c => c.id === cartaJogada.id);
      if (index !== -1) jogadorAtual.mao.splice(index, 1);
      sala.mesa.push(cartaJogada);
    });

    const ultimaCartaJogada = sala.mesa[sala.mesa.length - 1];
    if (ultimaCartaJogada.cor === 'preto' && novaCor) {
      ultimaCartaJogada.cor = novaCor;
    }

    let pulos = 1;
    const valorCarta = cartas[0].valor;

    if (valorCarta === 'inverter') {
      if (cartas.length % 2 !== 0) {
        sala.sentido *= -1;
      }
    } else if (valorCarta === 'bloqueio') {
      pulos = cartas.length + 1; 
    }

    const temZero = cartas.some(c => c.valor === '0');
    if (temZero && alvoTroca) {
      if (alvoTroca === 'ninguem') {
        io.to(codigoSala).emit('erro', `🙊 ${jogadorAtual.nome} decidiu manter suas cartas!`);
      } 
      else if (alvoTroca === 'todos') {
        const maosAntigas = sala.jogadores.map(j => [...j.mao]);
        sala.jogadores.forEach((jogador, i) => {
          const indexDeQuemPassou = (i - sala.sentido + sala.jogadores.length) % sala.jogadores.length;
          jogador.mao = maosAntigas[indexDeQuemPassou];
        });
        io.to(codigoSala).emit('erro', `🌪️ ${jogadorAtual.nome} girou as cartas da mesa!`);
      } 
      else {
        const jogadorAlvo = sala.jogadores.find(j => j.id === alvoTroca);
        if (jogadorAlvo) {
          const maoTemp = [...jogadorAtual.mao];
          jogadorAtual.mao = [...jogadorAlvo.mao];
          jogadorAlvo.mao = maoTemp;
          io.to(codigoSala).emit('erro', `🔄 ${jogadorAtual.nome} trocou as cartas com ${jogadorAlvo.nome}!`);
        }
      }
    }

    if (valorCarta === '+2') {
      sala.comprasAcumuladas += (2 * cartas.length);
    } else if (valorCarta === '+4') {
      sala.comprasAcumuladas += (4 * cartas.length);
    }

    if (valorCarta === '9') {
      sala.eventoBateMesa = { ativo: true, jogadoresQueBateram: [], punicao: cartas.length };
      io.to(codigoSala).emit('iniciar_evento_nove');
    }

    sala.turnoIndex = (sala.turnoIndex + (pulos * sala.sentido)) % sala.jogadores.length;
    if (sala.turnoIndex < 0) {
      sala.turnoIndex += sala.jogadores.length; 
    }

    sala.comprouNestaRodada = false;

    if (jogadorAtual.mao.length === 0) {
      sala.status = 'finalizado';
      io.to(codigoSala).emit('fim_de_jogo', jogadorAtual.nome);
      return; 
    }

    sala.jogadores.forEach(jogador => {
      io.to(jogador.id).emit('estado_atualizado', {
        minhaMao: jogador.mao,
        cartaMesa: sala.mesa[sala.mesa.length - 1],
        turnoAtual: sala.jogadores[sala.turnoIndex].id,
        sentido: sala.sentido,
        comprouNestaRodada: sala.comprouNestaRodada,
        comprasAcumuladas: sala.comprasAcumuladas,
        infoJogadores: obterInfoJogadores(sala)
      });
    });
  });

  socket.on('apertar_uno', (codigoSala) => {
    const sala = salas[codigoSala];
    if (!sala || sala.status !== 'jogando') return;

    const eu = sala.jogadores.find(j => j.id === socket.id);
    let denunciouAlguem = false;
    let nomeInfrator = '';
    
    sala.jogadores.forEach(jogador => {
      if (jogador.mao.length === 1 && !jogador.disseUno && jogador.id !== eu.id) {
        if (sala.baralho.length > 0) jogador.mao.push(sala.baralho.pop());
        denunciouAlguem = true;
        nomeInfrator = jogador.nome;
      }
    });

    if (denunciouAlguem) {
      io.to(codigoSala).emit('erro', `🚨 O jogador ${nomeInfrator} esqueceu de gritar UNO e comprou 1 carta!`);
      sala.jogadores.forEach(j => {
        io.to(j.id).emit('estado_atualizado', {
          minhaMao: j.mao,
          cartaMesa: sala.mesa[sala.mesa.length - 1],
          turnoAtual: sala.jogadores[sala.turnoIndex].id,
          sentido: sala.sentido,
          comprouNestaRodada: sala.comprouNestaRodada,
          comprasAcumuladas: sala.comprasAcumuladas,
          infoJogadores: obterInfoJogadores(sala)
        });
      });
      return; 
    }

    if (eu.mao.length <= 2) {
      eu.disseUno = true;
      io.to(codigoSala).emit('erro', `🗣️ ${eu.nome} GRITOU UNO!`);
    } else {
      socket.emit('erro', `Ninguém para denunciar! Você só pode gritar UNO tendo 1 ou 2 cartas.`);
    }
  });

  socket.on('comprar_carta', (codigoSala) => {
    const sala = salas[codigoSala];
    if (!sala || sala.status !== 'jogando') return;
    
    const jogadorAtual = sala.jogadores[sala.turnoIndex];
    if (jogadorAtual.id !== socket.id) return;
    if (sala.comprouNestaRodada) return; 

    const qtdParaComprar = sala.comprasAcumuladas > 0 ? sala.comprasAcumuladas : 1;

    for (let i = 0; i < qtdParaComprar; i++) {
      if (sala.baralho.length > 0) {
        jogadorAtual.mao.push(sala.baralho.pop());
      }
    }
    jogadorAtual.disseUno = false;

    if (sala.comprasAcumuladas > 0) {
      sala.comprasAcumuladas = 0;
      sala.turnoIndex = (sala.turnoIndex + sala.sentido + sala.jogadores.length) % sala.jogadores.length;
    } else {
      sala.comprouNestaRodada = true;
    }

    sala.jogadores.forEach(jogador => {
      io.to(jogador.id).emit('estado_atualizado', {
        minhaMao: jogador.mao,
        cartaMesa: sala.mesa[sala.mesa.length - 1],
        turnoAtual: sala.jogadores[sala.turnoIndex].id,
        sentido: sala.sentido,
        comprouNestaRodada: sala.comprouNestaRodada,
        comprasAcumuladas: sala.comprasAcumuladas,
        infoJogadores: obterInfoJogadores(sala)
      });
    });
  });

  socket.on('passar_vez', (codigoSala) => {
    const sala = salas[codigoSala];
    if (!sala || sala.status !== 'jogando') return;
    
    const jogadorAtual = sala.jogadores[sala.turnoIndex];
    if (jogadorAtual.id !== socket.id) return;
    if (!sala.comprouNestaRodada) return; 

    sala.turnoIndex = (sala.turnoIndex + 1) % sala.jogadores.length;
    sala.comprouNestaRodada = false;

    sala.jogadores.forEach(jogador => {
      io.to(jogador.id).emit('estado_atualizado', {
        minhaMao: jogador.mao,
        cartaMesa: sala.mesa[sala.mesa.length - 1],
        turnoAtual: sala.jogadores[sala.turnoIndex].id,
        sentido: sala.sentido,
        comprouNestaRodada: sala.comprouNestaRodada,
        comprasAcumuladas: sala.comprasAcumuladas,
        infoJogadores: obterInfoJogadores(sala)
      });
    });
  });

  socket.on('bater_mesa', (codigoSala) => {
    const sala = salas[codigoSala];
    if (!sala || !sala.eventoBateMesa || !sala.eventoBateMesa.ativo) return;
    if (sala.eventoBateMesa.jogadoresQueBateram.includes(socket.id)) return;

    sala.eventoBateMesa.jogadoresQueBateram.push(socket.id);

    const totalJogadores = sala.jogadores.length;
    const bateram = sala.eventoBateMesa.jogadoresQueBateram.length;

    if (bateram === totalJogadores - 1) {
      const lerdinho = sala.jogadores.find(j => !sala.eventoBateMesa.jogadoresQueBateram.includes(j.id));
      for (let i = 0; i < sala.eventoBateMesa.punicao; i++) {
        if (sala.baralho.length > 0) lerdinho.mao.push(sala.baralho.pop());
      }
      sala.eventoBateMesa.ativo = false;

      io.to(codigoSala).emit('fim_evento_nove', {
        perdedor: lerdinho.nome,
        cartasCompradas: sala.eventoBateMesa.punicao
      });

      sala.jogadores.forEach(jogador => {
        io.to(jogador.id).emit('estado_atualizado', {
          minhaMao: jogador.mao,
          cartaMesa: sala.mesa[sala.mesa.length - 1],
          turnoAtual: sala.jogadores[sala.turnoIndex].id,
          sentido: sala.sentido,
          comprouNestaRodada: sala.comprouNestaRodada,
          comprasAcumuladas: sala.comprasAcumuladas,
          infoJogadores: obterInfoJogadores(sala)
        });
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Jogador desconectado: ${socket.id}`);
  });
});

const porta = process.env.PORT || 3001;
server.listen(porta, () => {
  console.log(`Servidor rodando na porta ${porta}!`);
});