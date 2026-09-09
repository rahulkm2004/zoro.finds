/**
 * ZORO.FINDS — Admin Order Notification Email Service
 * Mailjet Transactional Email Integration
 */

/**
 * Format currency in Indian Rupees (INR)
 */
function formatINR(amount) {
  const num = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  return '₹' + num.toLocaleString('en-IN');
}

/**
 * Format timestamp to readable date/time (IST friendly)
 */
function formatOrderDate(isoString) {
  try {
    const d = isoString ? new Date(isoString) : new Date();
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'full',
      timeStyle: 'medium'
    }) + ' (IST)';
  } catch (e) {
    return new Date().toISOString();
  }
}

/**
 * Generates the responsive, fashion-editorial HTML email for the ZORO.FINDS Admin
 */
function generateAdminOrderEmailHtml(order) {
  const orderNumber = order.order_number || order.orderNumber || order.id || 'N/A';
  const orderId = order.id || order.order_id || 'N/A';
  const orderDate = formatOrderDate(order.created_at || order.createdAt);
  const customerName = order.customer_name || order.customerName || order.customer?.name || 'Customer';
  const customerPhone = order.customer_phone || order.customerPhone || order.customer?.phone || 'N/A';
  const customerEmail = order.customer_email || order.customerEmail || order.customer?.email || 'Not provided';
  const shippingAddress = order.shipping_address || order.shippingAddress || order.customer?.address || 'N/A';
  const city = order.city || order.customer?.city || '';
  const state = order.state || order.customer?.state || '';
  const pincode = order.pincode || order.customer?.pincode || '';
  
  const paymentMethod = (order.payment_method || order.paymentMethod || 'ONLINE').toUpperCase();
  const isCod = paymentMethod === 'COD';
  const paymentStatus = order.payment_status || order.paymentStatus || (isCod ? 'COD ADVANCE PAID' : 'PAID');
  const orderStatus = order.order_status || order.orderStatus || 'CONFIRMED';
  
  const subtotal = order.subtotal_amount ?? order.subtotalAmount ?? 0;
  const shippingCharge = order.shipping_charge ?? order.shippingCharge ?? (isCod ? 100 : 0);
  const totalAmount = order.total_amount ?? order.totalAmount ?? (subtotal + shippingCharge);
  const advancePaid = order.advance_amount ?? order.advancePaid ?? (isCod ? 200 : totalAmount);
  const remainingToCollect = order.remaining_amount ?? order.remainingAmount ?? (isCod ? Math.max(0, totalAmount - 200) : 0);

  const rawProducts = order.products || order.items || [];
  const products = Array.isArray(rawProducts) ? rawProducts : (typeof rawProducts === 'string' ? JSON.parse(rawProducts) : []);

  // Format packing list items
  const packingItemsHtml = products.map((item, idx) => {
    const pid = item.id || '1-OF-1';
    const pname = item.product_name || item.name || 'Curated Vintage Item';
    const pcat = (item.category || (pid.startsWith('ZH') || pid.toLowerCase().includes('hoodie') ? 'HOODIES' : 'JACKETS')).toUpperCase();
    const pqty = item.quantity || 1;
    const pprice = item.numeric_price ? formatINR(item.numeric_price) : (item.price ? (typeof item.price === 'number' ? formatINR(item.price) : item.price) : 'N/A');

    return `
      <div style="background: #ffffff; border: 1px solid #e5e5e5; border-left: 4px solid #c89d55; padding: 14px 16px; margin-bottom: 12px; border-radius: 4px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <tr>
            <td style="padding-bottom: 6px;">
              <span style="display: inline-block; background: #000000; color: #ffffff; font-family: 'Courier New', Courier, monospace; font-size: 13px; font-weight: bold; letter-spacing: 0.08em; padding: 3px 8px; border-radius: 2px;">
                ID: ${pid}
              </span>
              <span style="display: inline-block; background: #f0f0f0; color: #333333; font-family: 'Courier New', Courier, monospace; font-size: 11px; font-weight: bold; letter-spacing: 0.05em; padding: 3px 6px; border-radius: 2px; margin-left: 6px;">
                ${pcat}
              </span>
            </td>
          </tr>
          <tr>
            <td style="font-size: 15px; font-weight: 700; color: #111111; line-height: 1.4; padding-bottom: 4px;">
              ${pname}
            </td>
          </tr>
          <tr>
            <td style="font-size: 13px; color: #666666;">
              <strong>Quantity:</strong> ${pqty} &nbsp;|&nbsp; <strong>Price:</strong> <span style="font-family: 'Courier New', Courier, monospace; color: #111111; font-weight: bold;">${pprice}</span>
            </td>
          </tr>
        </table>
      </div>
    `;
  }).join('');

  // Format order table rows
  const orderTableRows = products.map(item => {
    const pid = item.id || '1-OF-1';
    const pname = item.product_name || item.name || 'Curated Vintage Item';
    const pcat = (item.category || (pid.startsWith('ZH') || pid.toLowerCase().includes('hoodie') ? 'HOODIES' : 'JACKETS')).toUpperCase();
    const pqty = item.quantity || 1;
    const pprice = item.numeric_price ? formatINR(item.numeric_price) : (item.price ? (typeof item.price === 'number' ? formatINR(item.price) : item.price) : 'N/A');

    return `
      <tr>
        <td style="padding: 12px 10px; border-bottom: 1px solid #eeeeee; font-size: 13px; font-family: 'Courier New', Courier, monospace; font-weight: bold; color: #111111;">
          ${pid}
        </td>
        <td style="padding: 12px 10px; border-bottom: 1px solid #eeeeee; font-size: 13px; color: #222222;">
          <div style="font-weight: 600;">${pname}</div>
          <div style="font-size: 11px; color: #888888; text-transform: uppercase; font-family: 'Courier New', Courier, monospace;">${pcat}</div>
        </td>
        <td style="padding: 12px 10px; border-bottom: 1px solid #eeeeee; font-size: 13px; text-align: center; color: #444444; font-family: 'Courier New', Courier, monospace;">
          ${pqty}
        </td>
        <td style="padding: 12px 10px; border-bottom: 1px solid #eeeeee; font-size: 13px; text-align: right; font-weight: bold; font-family: 'Courier New', Courier, monospace; color: #111111;">
          ${pprice}
        </td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NEW ORDER RECEIVED — ZORO.FINDS #${orderNumber}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #111111;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f5; padding: 24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Container -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 620px; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 6px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #080808; padding: 26px 24px; text-align: center; border-bottom: 3px solid #c89d55;">
              <div style="font-family: 'Georgia', serif; font-size: 24px; font-weight: 700; letter-spacing: 0.22em; color: #ffffff; text-transform: uppercase;">
                ZORO.FINDS
              </div>
              <div style="font-family: 'Courier New', Courier, monospace; font-size: 11px; letter-spacing: 0.16em; color: #c89d55; margin-top: 6px; text-transform: uppercase;">
                1-OF-1 CURATED THRIFT ARCHIVE · ADMIN DISPATCH
              </div>
            </td>
          </tr>

          <!-- Order Alert Bar -->
          <tr>
            <td style="background-color: #18181b; padding: 14px 24px; color: #ffffff;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <div style="font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.08em;">
                      NEW ORDER RECEIVED
                    </div>
                    <div style="font-size: 20px; font-weight: 800; color: #ffffff; font-family: 'Courier New', Courier, monospace; letter-spacing: 0.04em; margin-top: 2px;">
                      #${orderNumber}
                    </div>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <span style="background-color: ${isCod ? '#b45309' : '#15803d'}; color: #ffffff; font-size: 11px; font-weight: 700; font-family: 'Courier New', Courier, monospace; letter-spacing: 0.06em; padding: 5px 10px; border-radius: 3px; text-transform: uppercase;">
                      ${isCod ? '● COD ORDER' : '✓ PREPAID ORDER'}
                    </span>
                  </td>
                </tr>
              </table>
              <div style="font-size: 12px; color: #71717a; margin-top: 8px; font-family: 'Courier New', Courier, monospace;">
                Order Date: <span style="color: #e4e4e7;">${orderDate}</span>
              </div>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 24px;">

              <!-- ============================================== -->
              <!-- 1. PACKING SUMMARY (PROMINENT AT TOP)          -->
              <!-- ============================================== -->
              <div style="background-color: #fafafa; border: 2px solid #18181b; border-radius: 6px; padding: 18px 20px; margin-bottom: 24px;">
                <div style="font-family: 'Courier New', Courier, monospace; font-size: 13px; font-weight: 800; letter-spacing: 0.12em; color: #080808; text-transform: uppercase; margin-bottom: 14px; border-bottom: 1px solid #e4e4e7; padding-bottom: 8px;">
                  ✦ PACKING SUMMARY (ACTION REQUIRED)
                </div>

                <!-- Products to pack -->
                ${packingItemsHtml}

                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 13px; margin-top: 14px; border-top: 1px solid #e4e4e7; padding-top: 12px;">
                  <tr>
                    <td style="padding: 4px 0; color: #71717a; width: 40%;"><strong>Customer:</strong></td>
                    <td style="padding: 4px 0; color: #111111; font-weight: 700;">${customerName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #71717a;"><strong>Phone:</strong></td>
                    <td style="padding: 4px 0; color: #111111; font-weight: 700; font-family: 'Courier New', Courier, monospace;">
                      <a href="tel:${customerPhone}" style="color: #0969da; text-decoration: none;">${customerPhone}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #71717a;"><strong>Payment Method:</strong></td>
                    <td style="padding: 4px 0; font-weight: 700; color: ${isCod ? '#b45309' : '#15803d'}; font-family: 'Courier New', Courier, monospace;">
                      ${paymentMethod}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0 4px 0; color: #080808; font-weight: 800; font-size: 14px;"><strong>AMOUNT TO COLLECT:</strong></td>
                    <td style="padding: 8px 0 4px 0; font-weight: 800; font-size: 16px; font-family: 'Courier New', Courier, monospace; color: ${isCod ? '#b45309' : '#15803d'};">
                      ${isCod ? formatINR(remainingToCollect) + ' (CASH ON DELIVERY)' : '₹0 (PAID IN FULL)'}
                    </td>
                  </tr>
                </table>
              </div>

              <!-- ============================================== -->
              <!-- 2. CUSTOMER & DELIVERY DETAILS                 -->
              <!-- ============================================== -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
                <tr>
                  <!-- Customer Details -->
                  <td width="48%" style="vertical-align: top; background: #fafafa; border: 1px solid #e4e4e7; border-radius: 4px; padding: 16px;">
                    <div style="font-family: 'Courier New', Courier, monospace; font-size: 11px; font-weight: bold; letter-spacing: 0.1em; color: #71717a; text-transform: uppercase; margin-bottom: 10px;">
                      CUSTOMER DETAILS
                    </div>
                    <div style="font-size: 14px; font-weight: 700; color: #111111; margin-bottom: 4px;">
                      ${customerName}
                    </div>
                    <div style="font-size: 13px; color: #444444; margin-bottom: 4px; font-family: 'Courier New', Courier, monospace;">
                      <a href="tel:${customerPhone}" style="color: #0969da; text-decoration: none;">📞 ${customerPhone}</a>
                    </div>
                    <div style="font-size: 12px; color: #666666;">
                      ✉ ${customerEmail}
                    </div>
                  </td>

                  <td width="4%"></td>

                  <!-- Delivery Address -->
                  <td width="48%" style="vertical-align: top; background: #fafafa; border: 1px solid #e4e4e7; border-radius: 4px; padding: 16px;">
                    <div style="font-family: 'Courier New', Courier, monospace; font-size: 11px; font-weight: bold; letter-spacing: 0.1em; color: #71717a; text-transform: uppercase; margin-bottom: 10px;">
                      DELIVERY ADDRESS
                    </div>
                    <div style="font-size: 13px; font-weight: 600; color: #111111; line-height: 1.5;">
                      ${shippingAddress}
                    </div>
                    <div style="font-size: 13px; font-weight: 700; color: #080808; margin-top: 6px; font-family: 'Courier New', Courier, monospace;">
                      ${city ? city + ', ' : ''}${state} — ${pincode}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- ============================================== -->
              <!-- 3. ORDER DETAILS (ITEM BREAKDOWN)              -->
              <!-- ============================================== -->
              <div style="margin-bottom: 24px;">
                <div style="font-family: 'Courier New', Courier, monospace; font-size: 11px; font-weight: bold; letter-spacing: 0.1em; color: #71717a; text-transform: uppercase; margin-bottom: 8px;">
                  ORDER DETAILS (${products.length} ${products.length === 1 ? 'ITEM' : 'ITEMS'})
                </div>
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 4px;">
                  <thead>
                    <tr style="background: #f4f4f5;">
                      <th style="padding: 10px; font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #52525b; text-align: left; border-bottom: 1px solid #e4e4e7;">PRODUCT ID</th>
                      <th style="padding: 10px; font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #52525b; text-align: left; border-bottom: 1px solid #e4e4e7;">ITEM</th>
                      <th style="padding: 10px; font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #52525b; text-align: center; border-bottom: 1px solid #e4e4e7;">QTY</th>
                      <th style="padding: 10px; font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #52525b; text-align: right; border-bottom: 1px solid #e4e4e7;">PRICE</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${orderTableRows}
                  </tbody>
                </table>
              </div>

              <!-- ============================================== -->
              <!-- 4. PAYMENT SUMMARY                             -->
              <!-- ============================================== -->
              <div style="background: #fafafa; border: 1px solid #e4e4e7; border-radius: 4px; padding: 16px 20px; margin-bottom: 24px;">
                <div style="font-family: 'Courier New', Courier, monospace; font-size: 11px; font-weight: bold; letter-spacing: 0.1em; color: #71717a; text-transform: uppercase; margin-bottom: 12px; border-bottom: 1px solid #e4e4e7; padding-bottom: 6px;">
                  PAYMENT SUMMARY
                </div>
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 13px;">
                  <tr>
                    <td style="padding: 4px 0; color: #666666;">Subtotal:</td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; font-weight: 600; color: #111111;">
                      ${formatINR(subtotal)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #666666;">Shipping:</td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; font-weight: 600; color: ${isCod ? '#b45309' : '#15803d'};">
                      ${isCod ? '+₹100 (COD Shipping Fee)' : 'FREE (Pan-India Express)'}
                    </td>
                  </tr>
                  <tr style="font-size: 15px; font-weight: 800; border-top: 1px solid #e4e4e7;">
                    <td style="padding: 8px 0 4px 0; color: #111111;">Order Total:</td>
                    <td style="padding: 8px 0 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; color: #111111;">
                      ${formatINR(totalAmount)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #666666;">Payment Method:</td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; font-weight: 700; color: #111111;">
                      ${paymentMethod}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #15803d; font-weight: 700;">
                      ${isCod ? 'COD Advance Paid (Razorpay):' : 'Amount Paid (Razorpay):'}
                    </td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; font-weight: 700; color: #15803d;">
                      ${formatINR(advancePaid)}
                    </td>
                  </tr>
                  ${isCod ? `
                  <tr style="background: rgba(180, 83, 9, 0.08); font-weight: bold;">
                    <td style="padding: 8px 8px; color: #b45309; font-size: 13px;">
                      Remaining Amount To Collect:
                    </td>
                    <td style="padding: 8px 8px; text-align: right; font-family: 'Courier New', Courier, monospace; color: #b45309; font-size: 14px;">
                      ${formatINR(remainingToCollect)}
                    </td>
                  </tr>
                  ` : `
                  <tr>
                    <td style="padding: 4px 0; color: #71717a;">Remaining Balance:</td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; color: #71717a;">
                      ₹0
                    </td>
                  </tr>
                  `}
                </table>
              </div>

              <!-- ============================================== -->
              <!-- 5. STATUS & SYSTEM AUDIT                       -->
              <!-- ============================================== -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #18181b; color: #ffffff; border-radius: 4px; padding: 14px 16px; font-family: 'Courier New', Courier, monospace; font-size: 12px;">
                <tr>
                  <td>
                    <div style="color: #a1a1aa;">ORDER STATUS: <strong style="color: #22c55e;">${orderStatus}</strong></div>
                    <div style="color: #a1a1aa; margin-top: 4px;">PAYMENT STATUS: <strong style="color: #ffffff;">${paymentStatus}</strong></div>
                    <div style="color: #71717a; margin-top: 4px; font-size: 11px;">Razorpay Order: ${order.razorpay_order_id || 'N/A'}</div>
                    <div style="color: #71717a; font-size: 11px;">Razorpay Payment: ${order.razorpay_payment_id || 'N/A'}</div>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f4f5; padding: 20px 24px; text-align: center; border-top: 1px solid #e4e4e7; font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #71717a;">
              ZORO.FINDS STORE ENGINE · CONFIDENTIAL ADMIN NOTIFICATION<br>
              Every piece is 1-of-1. Inventory status has been automatically updated to SOLD OUT in D1.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generates plain text fallback email
 */
function generateAdminOrderEmailText(order) {
  const orderNumber = order.order_number || order.orderNumber || order.id || 'N/A';
  const orderDate = formatOrderDate(order.created_at || order.createdAt);
  const customerName = order.customer_name || order.customerName || order.customer?.name || 'Customer';
  const customerPhone = order.customer_phone || order.customerPhone || order.customer?.phone || 'N/A';
  const customerEmail = order.customer_email || order.customerEmail || order.customer?.email || 'Not provided';
  const shippingAddress = order.shipping_address || order.shippingAddress || order.customer?.address || 'N/A';
  const city = order.city || order.customer?.city || '';
  const state = order.state || order.customer?.state || '';
  const pincode = order.pincode || order.customer?.pincode || '';
  
  const paymentMethod = (order.payment_method || order.paymentMethod || 'ONLINE').toUpperCase();
  const isCod = paymentMethod === 'COD';
  const paymentStatus = order.payment_status || order.paymentStatus || (isCod ? 'COD ADVANCE PAID' : 'PAID');
  
  const subtotal = order.subtotal_amount ?? order.subtotalAmount ?? 0;
  const shippingCharge = order.shipping_charge ?? order.shippingCharge ?? (isCod ? 100 : 0);
  const totalAmount = order.total_amount ?? order.totalAmount ?? (subtotal + shippingCharge);
  const advancePaid = order.advance_amount ?? order.advancePaid ?? (isCod ? 200 : totalAmount);
  const remainingToCollect = order.remaining_amount ?? order.remainingAmount ?? (isCod ? Math.max(0, totalAmount - 200) : 0);

  const rawProducts = order.products || order.items || [];
  const products = Array.isArray(rawProducts) ? rawProducts : (typeof rawProducts === 'string' ? JSON.parse(rawProducts) : []);

  const itemsText = products.map((item, i) => {
    const pid = item.id || '1-OF-1';
    const pname = item.product_name || item.name || 'Vintage Piece';
    const pcat = item.category || 'VINTAGE';
    const pprice = item.numeric_price ? formatINR(item.numeric_price) : (item.price || 'N/A');
    return `[${i + 1}] PRODUCT ID: ${pid} | ${pname} (${pcat}) | Price: ${pprice}`;
  }).join('\n');

  return `
==================================================
NEW ORDER RECEIVED — ZORO.FINDS #${orderNumber}
==================================================
Order Date: ${orderDate}
Order Status: CONFIRMED
Payment Status: ${paymentStatus}

--- PACKING SUMMARY ---
${itemsText}

Customer: ${customerName}
Phone: ${customerPhone}
Payment Method: ${paymentMethod}
Amount to Collect: ${isCod ? formatINR(remainingToCollect) + ' (COD Remaining Balance)' : '₹0 (Prepaid in Full)'}

--- CUSTOMER & DELIVERY DETAILS ---
Name: ${customerName}
Phone: ${customerPhone}
Email: ${customerEmail}
Address: ${shippingAddress}
City/State/PIN: ${city}, ${state} — ${pincode}

--- PAYMENT SUMMARY ---
Subtotal: ${formatINR(subtotal)}
Shipping: ${isCod ? '+₹100 (COD Fee)' : 'FREE'}
Total Order Value: ${formatINR(totalAmount)}
Payment Method: ${paymentMethod}
Advance Paid: ${formatINR(advancePaid)}
Remaining Amount: ${isCod ? formatINR(remainingToCollect) : '₹0'}

Razorpay Order ID: ${order.razorpay_order_id || 'N/A'}
Razorpay Payment ID: ${order.razorpay_payment_id || 'N/A'}
==================================================
`.trim();
}

/**
 * Sends Admin Order Notification email via Mailjet API v3.1
 * 
 * @param {Object} order - Confirmed order data
 * @param {Object} env - Environment variables containing Mailjet credentials
 * @returns {Promise<{success: boolean, messageId?: string, error?: string, skipped?: boolean}>}
 */
async function sendAdminOrderNotification(order, env = {}) {
  const apiKey = env.MAILJET_API_KEY || (typeof process !== 'undefined' ? process.env?.MAILJET_API_KEY : '');
  const apiSecret = env.MAILJET_API_SECRET || (typeof process !== 'undefined' ? process.env?.MAILJET_API_SECRET : '');
  const senderEmail = env.MAILJET_SENDER_EMAIL || (typeof process !== 'undefined' ? process.env?.MAILJET_SENDER_EMAIL : '');
  const senderName = env.MAILJET_SENDER_NAME || (typeof process !== 'undefined' ? process.env?.MAILJET_SENDER_NAME : '') || 'ZORO.FINDS';
  const adminEmail = env.ADMIN_ORDER_EMAIL || (typeof process !== 'undefined' ? process.env?.ADMIN_ORDER_EMAIL : '');

  // Guard: If Mailjet credentials are not configured, log and gracefully skip without failing order
  if (!apiKey || !apiSecret || !senderEmail || !adminEmail) {
    console.warn('[Mailjet] Email notification skipped: Missing one or more required Mailjet environment variables (MAILJET_API_KEY, MAILJET_API_SECRET, MAILJET_SENDER_EMAIL, ADMIN_ORDER_EMAIL).');
    return {
      success: false,
      skipped: true,
      error: 'Mailjet environment variables not configured'
    };
  }

  const orderNumber = order.order_number || order.orderNumber || order.id || 'NEW';
  const subject = `NEW ORDER RECEIVED — ZORO.FINDS #${orderNumber}`;
  const htmlContent = generateAdminOrderEmailHtml(order);
  const textContent = generateAdminOrderEmailText(order);

  const authHeader = 'Basic ' + (typeof btoa === 'function' 
    ? btoa(`${apiKey}:${apiSecret}`)
    : Buffer.from(`${apiKey}:${apiSecret}`).toString('base64'));

  const payload = {
    Messages: [
      {
        From: {
          Email: senderEmail.trim(),
          Name: senderName.trim()
        },
        To: [
          {
            Email: adminEmail.trim(),
            Name: 'ZORO.FINDS Admin'
          }
        ],
        Subject: subject,
        HTMLPart: htmlContent,
        TextPart: textContent
      }
    ]
  };

  try {
    const response = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[Mailjet] Send failed with status:', response.status, result);
      return {
        success: false,
        status: response.status,
        error: result.ErrorMessage || result.message || 'Mailjet API error'
      };
    }

    const messageResult = result.Messages?.[0];
    if (messageResult?.Status === 'success') {
      console.log(`[Mailjet] Admin notification email successfully sent for order #${orderNumber}`);
      return {
        success: true,
        messageId: messageResult.To?.[0]?.MessageID || 'SENT'
      };
    } else {
      console.warn('[Mailjet] Message status not successful:', messageResult);
      return {
        success: false,
        error: messageResult?.Errors?.[0]?.ErrorMessage || 'Message sending issue'
      };
    }
  } catch (err) {
    console.error('[Mailjet] Exception while sending email:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Generates the responsive, fashion-editorial HTML order confirmation email for the CUSTOMER
 */
function generateCustomerOrderEmailHtml(order) {
  const orderNumber = order.order_number || order.orderNumber || order.id || 'N/A';
  const orderDate = formatOrderDate(order.created_at || order.createdAt);
  const customerName = order.customer_name || order.customerName || order.customer?.name || 'Valued Customer';
  const shippingAddress = order.shipping_address || order.shippingAddress || order.customer?.address || 'N/A';
  const city = order.city || order.customer?.city || '';
  const state = order.state || order.customer?.state || '';
  const pincode = order.pincode || order.customer?.pincode || '';
  
  const paymentMethod = (order.payment_method || order.paymentMethod || 'ONLINE').toUpperCase();
  const isCod = paymentMethod === 'COD';
  const paymentStatus = order.payment_status || order.paymentStatus || (isCod ? 'COD ADVANCE PAID' : 'PAID');
  
  const subtotal = order.subtotal_amount ?? order.subtotalAmount ?? 0;
  const shippingCharge = order.shipping_charge ?? order.shippingCharge ?? (isCod ? 100 : 0);
  const totalAmount = order.total_amount ?? order.totalAmount ?? (subtotal + shippingCharge);
  const advancePaid = order.advance_amount ?? order.advancePaid ?? (isCod ? 200 : totalAmount);
  const remainingToCollect = order.remaining_amount ?? order.remainingAmount ?? (isCod ? Math.max(0, totalAmount - 200) : 0);

  const rawProducts = order.products || order.items || [];
  const products = Array.isArray(rawProducts) ? rawProducts : (typeof rawProducts === 'string' ? JSON.parse(rawProducts) : []);

  const productsHtml = products.map((item, idx) => {
    const pid = item.id || '1-OF-1';
    const pname = item.product_name || item.name || 'Curated Vintage Item';
    const pcat = (item.category || (pid.startsWith('ZH') || pid.toLowerCase().includes('hoodie') ? 'HOODIES' : 'JACKETS')).toUpperCase();
    const pqty = item.quantity || 1;
    const pprice = item.numeric_price ? formatINR(item.numeric_price) : (item.price ? (typeof item.price === 'number' ? formatINR(item.price) : item.price) : 'N/A');

    return `
      <tr>
        <td style="padding: 14px 10px; border-bottom: 1px solid #eeeeee; vertical-align: top;">
          <span style="display: inline-block; background: #080808; color: #ffffff; font-family: 'Courier New', Courier, monospace; font-size: 11px; font-weight: bold; letter-spacing: 0.08em; padding: 2px 6px; border-radius: 2px;">
            ${pid}
          </span>
          <div style="font-size: 14px; font-weight: 700; color: #111111; margin-top: 4px; line-height: 1.4;">
            ${pname}
          </div>
          <div style="font-size: 11px; color: #71717a; font-family: 'Courier New', Courier, monospace; text-transform: uppercase; margin-top: 2px;">
            CATEGORY: ${pcat}
          </div>
        </td>
        <td style="padding: 14px 10px; border-bottom: 1px solid #eeeeee; font-size: 13px; text-align: center; color: #444444; font-family: 'Courier New', Courier, monospace; vertical-align: top;">
          ${pqty}
        </td>
        <td style="padding: 14px 10px; border-bottom: 1px solid #eeeeee; font-size: 14px; text-align: right; font-weight: bold; font-family: 'Courier New', Courier, monospace; color: #111111; vertical-align: top;">
          ${pprice}
        </td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZORO.FINDS — ORDER CONFIRMED #${orderNumber}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #111111;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f5; padding: 24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Container -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 6px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #080808; padding: 26px 24px; text-align: center; border-bottom: 3px solid #c89d55;">
              <div style="font-family: 'Georgia', serif; font-size: 24px; font-weight: 700; letter-spacing: 0.22em; color: #ffffff; text-transform: uppercase;">
                ZORO.FINDS
              </div>
              <div style="font-family: 'Courier New', Courier, monospace; font-size: 11px; letter-spacing: 0.16em; color: #c89d55; margin-top: 6px; text-transform: uppercase;">
                ORDER CONFIRMED
              </div>
            </td>
          </tr>

          <!-- Greeting Section -->
          <tr>
            <td style="padding: 24px 24px 16px 24px;">
              <div style="font-size: 18px; font-weight: 700; color: #111111; margin-bottom: 6px;">
                Hi ${customerName},
              </div>
              <div style="font-size: 15px; color: #27272a; line-height: 1.6; margin-bottom: 8px;">
                Thank you for shopping with <strong>ZORO.FINDS</strong> 🖤
              </div>
              <div style="font-size: 14px; color: #15803d; font-weight: 600; background: #eefbf2; border: 1px solid rgba(21, 128, 61, 0.2); padding: 10px 14px; border-radius: 4px; display: inline-block;">
                ✓ Your order has been successfully confirmed.
              </div>
            </td>
          </tr>

          <!-- Order Summary Card -->
          <tr>
            <td style="padding: 0 24px 20px 24px;">
              <div style="background: #fafafa; border: 1px solid #e4e4e7; border-radius: 4px; padding: 14px 18px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 13px;">
                  <tr>
                    <td style="padding: 4px 0; color: #71717a;"><strong>Order ID:</strong></td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; font-weight: bold; color: #111111;">#${orderNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #71717a;"><strong>Order Date:</strong></td>
                    <td style="padding: 4px 0; text-align: right; color: #333333;">${orderDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #71717a;"><strong>Payment Method:</strong></td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; font-weight: bold; color: ${isCod ? '#b45309' : '#15803d'};">
                      ${paymentMethod}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #71717a;"><strong>Payment Status:</strong></td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; font-weight: bold; color: #111111;">
                      ${paymentStatus}
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- Items Ordered Table -->
          <tr>
            <td style="padding: 0 24px 20px 24px;">
              <div style="font-family: 'Courier New', Courier, monospace; font-size: 11px; font-weight: bold; letter-spacing: 0.1em; color: #71717a; text-transform: uppercase; margin-bottom: 8px;">
                YOUR ORDERED ITEMS
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 4px;">
                <thead>
                  <tr style="background: #f4f4f5;">
                    <th style="padding: 10px; font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #52525b; text-align: left; border-bottom: 1px solid #e4e4e7;">ITEM</th>
                    <th style="padding: 10px; font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #52525b; text-align: center; border-bottom: 1px solid #e4e4e7;">QTY</th>
                    <th style="padding: 10px; font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #52525b; text-align: right; border-bottom: 1px solid #e4e4e7;">PRICE</th>
                  </tr>
                </thead>
                <tbody>
                  ${productsHtml}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Price Summary -->
          <tr>
            <td style="padding: 0 24px 20px 24px;">
              <div style="background: #fafafa; border: 1px solid #e4e4e7; border-radius: 4px; padding: 16px 18px;">
                <div style="font-family: 'Courier New', Courier, monospace; font-size: 11px; font-weight: bold; letter-spacing: 0.1em; color: #71717a; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1px solid #e4e4e7; padding-bottom: 6px;">
                  PRICE SUMMARY
                </div>
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 13px;">
                  <tr>
                    <td style="padding: 4px 0; color: #666666;">Subtotal:</td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; font-weight: 600; color: #111111;">
                      ${formatINR(subtotal)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #666666;">Shipping:</td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; font-weight: 600; color: ${isCod ? '#b45309' : '#15803d'};">
                      ${isCod ? '+₹100 (COD Shipping Fee)' : 'FREE (Pan-India Express)'}
                    </td>
                  </tr>
                  <tr style="font-size: 15px; font-weight: 800; border-top: 1px solid #e4e4e7;">
                    <td style="padding: 8px 0 4px 0; color: #111111;">Total:</td>
                    <td style="padding: 8px 0 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; color: #111111;">
                      ${formatINR(totalAmount)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #15803d; font-weight: 700;">
                      ${isCod ? 'COD Advance Paid:' : 'Amount Paid:'}
                    </td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; font-weight: 700; color: #15803d;">
                      ${formatINR(advancePaid)}
                    </td>
                  </tr>
                  ${isCod ? `
                  <tr style="background: rgba(180, 83, 9, 0.08); font-weight: bold;">
                    <td style="padding: 8px 8px; color: #b45309; font-size: 13px;">
                      Remaining Amount To Be Paid At Delivery:
                    </td>
                    <td style="padding: 8px 8px; text-align: right; font-family: 'Courier New', Courier, monospace; color: #b45309; font-size: 14px;">
                      ${formatINR(remainingToCollect)}
                    </td>
                  </tr>
                  ` : `
                  <tr>
                    <td style="padding: 4px 0; color: #71717a;">Remaining:</td>
                    <td style="padding: 4px 0; text-align: right; font-family: 'Courier New', Courier, monospace; color: #71717a;">
                      ₹0
                    </td>
                  </tr>
                  `}
                </table>

                ${isCod ? `
                <div style="margin-top: 12px; font-size: 12px; color: #b45309; background: #fef3c7; border: 1px solid #fde68a; padding: 10px 12px; border-radius: 4px; line-height: 1.5;">
                  <strong>Cash on Delivery Note:</strong> ₹200 advance payment has been received. The remaining <strong>${formatINR(remainingToCollect)}</strong> will be collected at the time of delivery.
                </div>
                ` : `
                <div style="margin-top: 10px; font-size: 12px; color: #15803d; background: #eefbf2; border: 1px solid rgba(21, 128, 61, 0.2); padding: 8px 12px; border-radius: 4px;">
                  ✓ Payment received in full. No additional balance to pay.
                </div>
                `}
              </div>
            </td>
          </tr>

          <!-- Delivery Address -->
          <tr>
            <td style="padding: 0 24px 20px 24px;">
              <div style="background: #fafafa; border: 1px solid #e4e4e7; border-radius: 4px; padding: 16px 18px;">
                <div style="font-family: 'Courier New', Courier, monospace; font-size: 11px; font-weight: bold; letter-spacing: 0.1em; color: #71717a; text-transform: uppercase; margin-bottom: 8px;">
                  SHIPPING ADDRESS
                </div>
                <div style="font-size: 14px; font-weight: 600; color: #111111; line-height: 1.5;">
                  ${shippingAddress}
                </div>
                <div style="font-size: 13px; font-weight: 700; color: #080808; margin-top: 4px; font-family: 'Courier New', Courier, monospace;">
                  ${city ? city + ', ' : ''}${state} - ${pincode}
                </div>
              </div>
            </td>
          </tr>

          <!-- Thank You Message -->
          <tr>
            <td style="padding: 0 24px 24px 24px; text-align: center;">
              <div style="font-size: 14px; color: #444444; line-height: 1.6; border-top: 1px solid #e4e4e7; padding-top: 18px;">
                <div style="margin-bottom: 12px; color: #111111; font-weight: 600;">
                  Your tracking ID will be sent to your WhatsApp shortly.
                </div>
                Thank you for choosing <strong>ZORO.FINDS</strong>. Your order means a lot to us. We'll keep you updated when your order is dispatched.
              </div>
              <div style="margin-top: 14px; font-size: 12px; color: #71717a;">
                Need help with sizing or delivery? Reach out to us anytime:
                <div style="margin-top: 6px;">
                  <a href="https://instagram.com/zoro.finds" style="color: #0969da; text-decoration: none; font-weight: bold; margin-right: 12px;">Instagram @zoro.finds</a>
                  <a href="https://wa.me/916362911551" style="color: #15803d; text-decoration: none; font-weight: bold;">WhatsApp +91 6362911551</a>
                </div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #080808; padding: 18px 24px; text-align: center; font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #a1a1aa;">
              ZORO.FINDS · 1-OF-1 CURATED THRIFT ARCHIVE · PAN-INDIA DELIVERY
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generates the plain text customer order confirmation email
 */
function generateCustomerOrderEmailText(order) {
  const orderNumber = order.order_number || order.orderNumber || order.id || 'N/A';
  const orderDate = formatOrderDate(order.created_at || order.createdAt);
  const customerName = order.customer_name || order.customerName || order.customer?.name || 'Customer';
  const shippingAddress = order.shipping_address || order.shippingAddress || order.customer?.address || 'N/A';
  const city = order.city || order.customer?.city || '';
  const state = order.state || order.customer?.state || '';
  const pincode = order.pincode || order.customer?.pincode || '';
  
  const paymentMethod = (order.payment_method || order.paymentMethod || 'ONLINE').toUpperCase();
  const isCod = paymentMethod === 'COD';
  const paymentStatus = order.payment_status || order.paymentStatus || (isCod ? 'COD ADVANCE PAID' : 'PAID');
  
  const subtotal = order.subtotal_amount ?? order.subtotalAmount ?? 0;
  const shippingCharge = order.shipping_charge ?? order.shippingCharge ?? (isCod ? 100 : 0);
  const totalAmount = order.total_amount ?? order.totalAmount ?? (subtotal + shippingCharge);
  const advancePaid = order.advance_amount ?? order.advancePaid ?? (isCod ? 200 : totalAmount);
  const remainingToCollect = order.remaining_amount ?? order.remainingAmount ?? (isCod ? Math.max(0, totalAmount - 200) : 0);

  const rawProducts = order.products || order.items || [];
  const products = Array.isArray(rawProducts) ? rawProducts : (typeof rawProducts === 'string' ? JSON.parse(rawProducts) : []);

  const itemsText = products.map((item, i) => {
    const pid = item.id || '1-OF-1';
    const pname = item.product_name || item.name || 'Vintage Piece';
    const pcat = item.category || 'VINTAGE';
    const pprice = item.numeric_price ? formatINR(item.numeric_price) : (item.price || 'N/A');
    return `[${i + 1}] ID: ${pid} | ${pname} (${pcat}) | Qty: ${item.quantity || 1} | Price: ${pprice}`;
  }).join('\n');

  return `
==================================================
ZORO.FINDS — ORDER CONFIRMED #${orderNumber}
==================================================
Hi ${customerName},

Thank you for shopping with ZORO.FINDS 🖤
Your order has been successfully confirmed.

--- ORDER DETAILS ---
Order ID: #${orderNumber}
Order Date: ${orderDate}
Payment Method: ${paymentMethod}
Payment Status: ${paymentStatus}

--- PRODUCTS ---
${itemsText}

--- PRICE SUMMARY ---
Subtotal: ${formatINR(subtotal)}
Shipping: ${isCod ? '+₹100 (COD Fee)' : 'FREE (Pan-India Express)'}
Total: ${formatINR(totalAmount)}
${isCod ? `COD Advance Paid: ${formatINR(advancePaid)}\nRemaining Amount To Be Paid At Delivery: ${formatINR(remainingToCollect)}\n(₹200 advance payment has been received. The remaining ${formatINR(remainingToCollect)} will be collected at the time of delivery.)` : `Amount Paid: ${formatINR(totalAmount)}\nRemaining: ₹0`}

--- SHIPPING ADDRESS ---
${shippingAddress}
${city}, ${state} - ${pincode}

---
Your tracking ID will be sent to your WhatsApp shortly.

Thank you for choosing ZORO.FINDS. Your order means a lot to us. We'll keep you updated when your order is dispatched.

Customer Support:
Instagram: @zoro.finds
WhatsApp: +91 6362911551
==================================================
`.trim();
}

/**
 * Sends Customer Order Confirmation email via Mailjet API v3.1
 * 
 * @param {Object} order - Confirmed order data
 * @param {Object} env - Environment variables containing Mailjet credentials
 * @returns {Promise<{success: boolean, messageId?: string, error?: string, skipped?: boolean}>}
 */
async function sendCustomerOrderConfirmation(order, env = {}) {
  const apiKey = env.MAILJET_API_KEY || (typeof process !== 'undefined' ? process.env?.MAILJET_API_KEY : '');
  const apiSecret = env.MAILJET_API_SECRET || (typeof process !== 'undefined' ? process.env?.MAILJET_API_SECRET : '');
  const senderEmail = env.MAILJET_SENDER_EMAIL || (typeof process !== 'undefined' ? process.env?.MAILJET_SENDER_EMAIL : '');
  const senderName = env.MAILJET_SENDER_NAME || (typeof process !== 'undefined' ? process.env?.MAILJET_SENDER_NAME : '') || 'ZORO.FINDS';

  const customerEmail = order.customer_email || order.customerEmail || order.customer?.email || '';
  const customerName = order.customer_name || order.customerName || order.customer?.name || 'Valued Customer';

  // Guard: If customer email was not provided during checkout
  if (!customerEmail || !customerEmail.includes('@')) {
    console.log('[Mailjet] Customer confirmation email skipped: No valid customer email provided.');
    return {
      success: false,
      skipped: true,
      error: 'No valid customer email provided'
    };
  }

  // Guard: If Mailjet credentials are not configured
  if (!apiKey || !apiSecret || !senderEmail) {
    console.warn('[Mailjet] Customer email skipped: Missing Mailjet credentials.');
    return {
      success: false,
      skipped: true,
      error: 'Mailjet credentials not configured'
    };
  }

  const orderNumber = order.order_number || order.orderNumber || order.id || 'NEW';
  const subject = `ZORO.FINDS — ORDER CONFIRMED #${orderNumber}`;
  const htmlContent = generateCustomerOrderEmailHtml(order);
  const textContent = generateCustomerOrderEmailText(order);

  const authHeader = 'Basic ' + (typeof btoa === 'function' 
    ? btoa(`${apiKey}:${apiSecret}`)
    : Buffer.from(`${apiKey}:${apiSecret}`).toString('base64'));

  const payload = {
    Messages: [
      {
        From: {
          Email: senderEmail.trim(),
          Name: senderName.trim()
        },
        To: [
          {
            Email: customerEmail.trim(),
            Name: customerName.trim()
          }
        ],
        Subject: subject,
        HTMLPart: htmlContent,
        TextPart: textContent
      }
    ]
  };

  try {
    const response = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[Mailjet] Customer send failed with status:', response.status, result);
      return {
        success: false,
        status: response.status,
        error: result.ErrorMessage || result.message || 'Mailjet API error'
      };
    }

    const messageResult = result.Messages?.[0];
    if (messageResult?.Status === 'success') {
      console.log(`[Mailjet] Customer confirmation email successfully sent to ${customerEmail} for order #${orderNumber}`);
      return {
        success: true,
        messageId: messageResult.To?.[0]?.MessageID || 'SENT'
      };
    } else {
      console.warn('[Mailjet] Customer message status not successful:', messageResult);
      return {
        success: false,
        error: messageResult?.Errors?.[0]?.ErrorMessage || 'Message sending issue'
      };
    }
  } catch (err) {
    console.error('[Mailjet] Exception while sending customer email:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

export default {
  generateAdminOrderEmailHtml,
  generateAdminOrderEmailText,
  sendAdminOrderNotification,
  generateCustomerOrderEmailHtml,
  generateCustomerOrderEmailText,
  sendCustomerOrderConfirmation,
  formatINR,
  formatOrderDate
};

export {
  generateAdminOrderEmailHtml,
  generateAdminOrderEmailText,
  sendAdminOrderNotification,
  generateCustomerOrderEmailHtml,
  generateCustomerOrderEmailText,
  sendCustomerOrderConfirmation,
  formatINR,
  formatOrderDate
};
