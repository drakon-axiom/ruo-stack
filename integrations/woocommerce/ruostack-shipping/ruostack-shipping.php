<?php
/**
 * Plugin Name: RUOStack Shipping
 * Description: Live shipping rates from RUOStack at checkout — real, named carrier services (with the $12.99 flat fallback when rates are unavailable).
 * Version: 0.1.0
 * Author: RUOStack
 * Requires Plugins: woocommerce
 *
 * Brand-store side of the RUOStack rate proxy (fulfillment plan §4). At checkout
 * this calls POST {api}/api/shipping/rates with the cart's SKUs + destination and
 * renders the returned named services. The pick-&-pack fee + brand markup are
 * already baked into the prices server-side; nothing here computes pricing.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('woocommerce_shipping_init', function () {
    if (class_exists('RUOStack_Shipping_Method')) {
        return;
    }

    class RUOStack_Shipping_Method extends WC_Shipping_Method {
        public function __construct($instance_id = 0) {
            $this->id                 = 'ruostack';
            $this->instance_id        = absint($instance_id);
            $this->method_title       = 'RUOStack Shipping';
            $this->method_description = 'Live carrier rates from RUOStack, shown as named services.';
            $this->supports           = array('shipping-zones', 'instance-settings', 'settings');
            $this->init();
        }

        public function init() {
            $this->init_form_fields();
            $this->init_settings();
            $this->title = $this->get_option('title', 'Shipping');
            add_action('woocommerce_update_options_shipping_' . $this->id, array($this, 'process_admin_options'));
        }

        public function init_form_fields() {
            // Paste these from RUOStack → My Store (connection id + store key are
            // shown when you connect the store; the store key is the webhook secret).
            $this->form_fields = array(
                'title'         => array('title' => 'Method title', 'type' => 'text', 'default' => 'Shipping'),
                'api_base'      => array('title' => 'RUOStack API base URL', 'type' => 'text', 'default' => 'https://api.ruostack.com'),
                'connection_id' => array('title' => 'Connection ID', 'type' => 'text', 'description' => 'From RUOStack → My Store.'),
                'store_key'     => array('title' => 'Store key', 'type' => 'password', 'description' => 'The store/webhook secret from RUOStack.'),
            );
        }

        public function calculate_shipping($package = array()) {
            $api = rtrim($this->get_option('api_base'), '/');
            $cid = $this->get_option('connection_id');
            $key = $this->get_option('store_key');
            if (!$api || !$cid || !$key) {
                return; // not configured — let other methods handle it
            }

            $items = array();
            foreach ($package['contents'] as $item) {
                $product = isset($item['data']) ? $item['data'] : null;
                $sku     = $product ? $product->get_sku() : '';
                if ($sku) {
                    $items[] = array('sku' => $sku, 'qty' => (int) $item['quantity']);
                }
            }
            if (empty($items)) {
                return;
            }

            $dest = $package['destination'];
            $body = array(
                'connection_id' => $cid,
                'items'         => $items,
                'destination'   => array(
                    'zip'     => isset($dest['postcode']) ? $dest['postcode'] : '',
                    'state'   => isset($dest['state']) ? $dest['state'] : '',
                    'country' => isset($dest['country']) ? $dest['country'] : 'US',
                ),
            );

            $res = wp_remote_post($api . '/api/shipping/rates', array(
                'headers' => array('content-type' => 'application/json', 'x-ruostack-store-key' => $key),
                'body'    => wp_json_encode($body),
                'timeout' => 10,
            ));

            // On any failure, return nothing — Woo falls back to other methods /
            // the store's own flat rate. (RUOStack also returns a $12.99 fallback.)
            if (is_wp_error($res) || (int) wp_remote_retrieve_response_code($res) >= 400) {
                return;
            }
            $data = json_decode(wp_remote_retrieve_body($res), true);
            if (empty($data['rates'])) {
                return;
            }

            foreach ($data['rates'] as $rate) {
                $this->add_rate(array(
                    'id'       => $this->id . ':' . $rate['service_code'],
                    'label'    => $rate['service'], // named service, e.g. "USPS Ground Advantage (2–5 business days)"
                    'cost'     => number_format(((int) $rate['amount_cents']) / 100, 2, '.', ''),
                    'calc_tax' => 'per_order',
                ));
            }
        }
    }
});

add_filter('woocommerce_shipping_methods', function ($methods) {
    $methods['ruostack'] = 'RUOStack_Shipping_Method';
    return $methods;
});
