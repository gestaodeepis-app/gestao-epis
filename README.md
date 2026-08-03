# Gestão de EPIs v1.2 — Firebase

Esta versão conecta o sistema ao Firebase Authentication e Cloud Firestore.

## Alterações da v1.1
- Login real por e-mail/senha
- Leitura do perfil em users/{UID}
- Reconhecimento de PROPRIETARIO / ADMINISTRADOR / SSMA / VISUALIZADOR
- Bloqueio de usuário sem perfil ou inativo
- Logout
- Cadastros de usinas, colaboradores e EPIs no Firestore
- Movimentações e estoque usando transação do Firestore
- Auditoria no Firestore
- Dados locais de demonstração removidos

## Teste local
Abra um terminal nesta pasta e execute:

    python -m http.server 8080

Depois acesse no navegador:

    http://localhost:8080

Entre com o e-mail/senha que você criou no Firebase Authentication.

## Observação importante
O arquivo firebase-config.js foi mantido com a configuração do seu projeto.
Não compartilhe senhas de usuários. A configuração web do Firebase não substitui as regras de segurança do Firestore.

## Primeiro uso
O banco começa sem usinas, colaboradores, EPIs e estoque. Entre como PROPRIETARIO e cadastre a primeira usina.


## v1.2
- Cadastro de usinas simplificado: somente Nome da Usina / Unidade.
- Código e endereço removidos da interface.
- ID interno da usina continua sendo gerado automaticamente pelo Firestore.


## v1.2.4
- Interface escura inspirada no sistema de extintores.
- Menu lateral em verde escuro.
- Ícones adicionados ao menu.
- Ícone do sistema no sidebar e na tela de login com fundo transparente.


## v1.2.4
- Menu lateral ajustado para a cor #529468.
- Ícone principal maior e com transparência real.
- Arquivos de ícones/favicons atualizados sem fundo branco.
