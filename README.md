# Gestão de EPIs v1.3

Base: v1.2.3/v1.2.5, mantendo o visual aprovado e reorganizando as funcionalidades.

## Alterações
- Nova aba Configurações.
- Configuração de nome e logo da empresa.
- Logo da empresa passa a ser utilizada no menu e nos relatórios após configuração.
- Cadastro de usinas movido para Configurações.
- Removida a aba exclusiva de Usinas.
- Removida a aba Estoque.
- Removido o botão global "+ Nova movimentação".
- EPI simplificado para: nome, C.A., unidade, tamanhos e quantidade em estoque.
- EPI pode ser editado/reabastecido.
- Estoque baixa automaticamente em entregas e aumenta em devoluções.
- Entrega/devolução com usina automática pelo colaborador.
- Status da assinatura: Assinado (verde) e Pendente (vermelho), com edição posterior.
- Validade do C.A. e vida útil removidas da interface.
- Relatórios PDF/Impressão com nome e logo da empresa.
- Versão removida do menu lateral.

## IMPORTANTE — regras do Firestore
A v1.3 precisa das novas regras contidas em `firestore.rules`.
Após subir os arquivos no GitHub, copie o conteúdo de `firestore.rules` para:
Firebase Console → Firestore Database → Regras → Publicar.

Sem essa etapa, salvar Configurações e editar o status da assinatura poderá ser bloqueado.
