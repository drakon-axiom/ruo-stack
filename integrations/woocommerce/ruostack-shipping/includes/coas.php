<?php
if (!defined('ABSPATH')) { exit; }
function ruostack_coa_safe_url($value) {
    if (!is_string($value) || strlen($value)>2048 || preg_match('/[\s\\\\]/', $value)) return '';
    $parts=parse_url($value);
    if (!$parts || ($parts['scheme']??'')!=='https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) return '';
    if (!preg_match('~^/coa/(products/)?[a-f0-9-]{36}$~i', $parts['path']??'')) return '';
    return $value;
}
function ruostack_coa_allocations_html($rows, $plain_text=false) {
    if (!is_array($rows)) return '';
    $output='';
    foreach (array_slice($rows,0,200) as $row) {
        if (!is_array($row) || !is_string($row['lot_code']??null) || !is_numeric($row['qty']??null)) continue;
        $qty=(int)$row['qty'];$url=ruostack_coa_safe_url($row['certificate_url']??'');
        if (!$url || $qty<=0 || $qty!=$row['qty']) continue;
        $label='Lot '.substr($row['lot_code'],0,120).' — '.$qty.' units — COA';
        $output.=$plain_text ? "\n".strip_tags($label).': '.$url."\n" : '<p><a href="'.esc_url($url).'" target="_blank" rel="noopener noreferrer">'.esc_html($label).'</a></p>';
    }
    return $output;
}
function ruostack_coa_product() {
    global $product;
    if (!$product || !method_exists($product,'get_meta')) return;
    $url=ruostack_coa_safe_url($product->get_meta('_ruostack_coa_url',true));
    if ($url) echo '<p><a href="'.esc_url($url).'" target="_blank" rel="noopener noreferrer">Product certificate references</a> — actual shipped lots appear in your order.</p>';
}
// Woo invokes this inside its authorized order details and email templates.
// There is no public order lookup endpoint in this plugin.
function ruostack_coa_order_item($item_id,$item,$order,$plain_text=false) {
    if (!is_object($item) || !method_exists($item,'get_meta')) return;
    echo ruostack_coa_allocations_html($item->get_meta('_ruostack_coa_allocations',true),$plain_text);
}
add_action('woocommerce_single_product_summary','ruostack_coa_product',35);
add_action('woocommerce_order_item_meta_end','ruostack_coa_order_item',20,4);
