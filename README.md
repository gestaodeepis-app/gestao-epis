# Gestão de EPIs v1.4.1

Principais mudanças:
- Menu lateral mais estreito e perfil do usuário no rodapé.
- Logo da empresa maior e com cantos arredondados.
- Dashboard corrigido para não gerar rolagem horizontal da página.
- EPI separado por usina, com estoque independente por unidade.
- Devolução com destino Reestoque ou Descarte.
- Remoção de movimentações, colaboradores, EPIs, usinas e usuários conforme permissões.
- Proprietário pode remover usuários; Administrador não pode remover usuários; Visualizador não remove nada.
- Nome do usuário editável na aba Usuários.
- Relatório geral com busca sugestiva de colaborador, usina automática e período.

## IMPORTANTE
Esta versão precisa das novas regras do arquivo `firestore.rules`. Publique-as no Firebase após atualizar o GitHub.

Usuários removidos pelo sistema perdem o documento de perfil e, portanto, o acesso ao app. O registro correspondente no Firebase Authentication permanece até ser removido manualmente no console do Firebase.
