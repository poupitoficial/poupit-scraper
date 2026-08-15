-- Amplia o schema para: 4 categorias nao-alimentares novas, remocao da categoria
-- generica "mercearia" (nunca usada nas decisoes, so "mercearia_doce_salgada"), e
-- uma coluna subcategory em products.
--
-- Corre isto no SQL editor do Supabase ANTES de correr o scraper do Lidl ou as
-- versoes atualizadas do Continente/Pingo Doce (ambos passam a enviar subcategory
-- e, no caso do Lidl, categorias novas). Sem isto os inserts vao falhar por
-- violarem a constraint atual.

-- 1) reclassificacao de dados ja feita em producao (2820 produtos):
--    UPDATE products SET category = 'mercearia_doce_salgada' WHERE category = 'mercearia';
--    (ja foi executado; mantido aqui so como registo)

-- 2) nova constraint de category: remove 'mercearia', adiciona as 4 nao-alimentares
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check check (category in (
  'laticinios_ovos','talho_peixaria','frutas_legumes',
  'padaria_pastelaria','congelados','bebidas','mercearia_doce_salgada',
  'higiene_pessoal_beleza','bebe','casa_limpeza','animais_estimacao'
));

-- 3) coluna subcategory (texto livre, sem enum rigido porque cada categoria tem
--    a sua propria lista - ver src/*CategoryMap.js em cada scraper para os valores
--    usados de facto). Constraint por categoria abaixo evita erros de escrita.
alter table public.products add column if not exists subcategory text;

alter table public.products drop constraint if exists products_subcategory_check;
alter table public.products add constraint products_subcategory_check check (
  subcategory is null or (
    (category = 'laticinios_ovos' and subcategory in ('leite','iogurtes','queijos','manteiga_natas','ovos','sobremesas_lacteas','bebidas_iogurtes_vegetais'))
    or (category = 'talho_peixaria' and subcategory in ('carne_vaca','carne_porco','aves','peixe_fresco','marisco','charcutaria_enchidos'))
    or (category = 'frutas_legumes' and subcategory in ('fruta','legumes','saladas_prontas','frutos_secos','ervas_aromaticas'))
    or (category = 'padaria_pastelaria' and subcategory in ('pao','bolos_pastelaria','torradas_tostas','croissants_folhados'))
    or (category = 'congelados' and subcategory in ('gelados','vegetais_congelados','peixe_marisco_congelado','carne_congelada','pratos_prontos_congelados','massa_pizza_congelada'))
    or (category = 'bebidas' and subcategory in ('agua','refrigerantes_sumos','cafe_cha','cerveja','vinho','bebidas_espirituosas'))
    or (category = 'mercearia_doce_salgada' and subcategory in ('massas_arroz','conservas','azeite_oleos','molhos_temperos','snacks_aperitivos','chocolates_doces','bolachas_cereais','compotas_mel'))
    or (category = 'higiene_pessoal_beleza' and subcategory in ('cuidado_cabelo','higiene_oral','cuidado_pele','higiene_intima','desodorizantes','depilacao'))
    or (category = 'bebe' and subcategory in ('fraldas','leite_po_boioes','toalhitas','cuidado_bebe'))
    or (category = 'casa_limpeza' and subcategory in ('detergente_roupa','limpeza_casa','loica','papel_higienico_absorventes','sacos_lixo'))
    or (category = 'animais_estimacao' and subcategory in ('racao_cao','racao_gato','areia_gatos','acessorios_petiscos'))
  )
);

-- 4) supermercado Lidl (necessario para o scraper novo)
insert into public.supermarkets (name, slug)
values ('Lidl', 'lidl')
on conflict (slug) do nothing;
