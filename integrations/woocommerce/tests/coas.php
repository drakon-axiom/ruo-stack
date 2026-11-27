<?php
// Standalone rendering fixture: no WordPress database, customers or mail.
define('ABSPATH', __DIR__);
function add_action(...$args) { $GLOBALS['hooks'][$args[0]] = $args[1]; }
function esc_html($s) { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function esc_url($s) { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
require __DIR__ . '/../ruostack-shipping/includes/coas.php';
$url='https://backend.test/coa/12345678-1234-1234-1234-123456789012';
$html=ruostack_coa_allocations_html(array(array('lot_code'=>'A<script>', 'qty'=>3, 'certificate_url'=>$url),array('lot_code'=>'B','qty'=>9,'certificate_url'=>$url)),false);
if (strpos($html,'A&lt;script&gt;')===false || strpos($html,'3 units')===false || strpos($html,'9 units')===false || strpos($html,'<script>')!==false) throw new Exception('Escaping/quantities failed');
if (ruostack_coa_allocations_html(array(array('lot_code'=>'X','qty'=>1,'certificate_url'=>'javascript:alert(1)')),false)!=='') throw new Exception('Unsafe URL accepted');
if (strpos(ruostack_coa_allocations_html(array(array('lot_code'=>'A','qty'=>3,'certificate_url'=>$url)),true),$url)===false) throw new Exception('Plain email link missing');
if (!isset($GLOBALS['hooks']['woocommerce_order_item_meta_end']) || !isset($GLOBALS['hooks']['woocommerce_single_product_summary'])) throw new Exception('Render hooks missing');
class Item { function get_meta($key,$single) {return $GLOBALS['meta'][$key]??'';} }
$GLOBALS['meta']['_ruostack_coa_url']=$url;
$GLOBALS['product']=new Item();ob_start();ruostack_coa_product();$rendered=ob_get_clean();if(strpos($rendered,'Product certificate references')===false)throw new Exception('Product page missing');
$GLOBALS['meta']['_ruostack_coa_allocations']=array(array('lot_code'=>'A','qty'=>3,'certificate_url'=>$url));
ob_start();ruostack_coa_order_item(1,new Item(),null,false);$rendered=ob_get_clean();if(strpos($rendered,'3 units')===false)throw new Exception('Order/email missing');
echo "COA rendering fixtures passed\n";
