const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder,
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const SUBS_PATH = path.join(__dirname, 'active_subscriptions.json');

let config = {};
if (fs.existsSync(CONFIG_PATH)) {
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {}
}

const LOCAL_CONFIG_PATH = path.join(__dirname, 'config.local.json');
if (fs.existsSync(LOCAL_CONFIG_PATH)) {
    try {
        const local = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
        config = { ...config, ...local };
    } catch (e) {}
}

const botToken = process.env.BOT_TOKEN || config.bot_token;

// HTTP Server for Render Health Checks (keeps Web Service alive)
const PORT = process.env.PORT || 3001;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'online',
        bot: client.user ? client.user.tag : 'connecting',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    }));
});
server.on('error', (e) => {
    console.warn('[HTTP Server Warning]', e.message);
});
server.listen(PORT, () => {
    console.log(`[Render Web Service] Health server listening on port ${PORT}`);
});

// Self-ping every 10 minutes to prevent sleep
setInterval(() => {
    fetch('https://udvengers-auth-bot.onrender.com')
        .then(() => console.log('[Keep-Alive] 10m self-ping executed.'))
        .catch(() => {});
}, 10 * 60 * 1000);

// Load or create subscription store
function loadSubscriptions() {
    try {
        if (fs.existsSync(SUBS_PATH)) {
            return JSON.parse(fs.readFileSync(SUBS_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading subscriptions:', e);
    }
    return [];
}

function saveSubscriptions(subs) {
    try {
        fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf8');
    } catch (e) {
        console.error('Error saving subscriptions:', e);
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 1. Panel: License Key Activation (No emojis, no footer)
function createRedeemPanel() {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('License Key Activation')
        .setDescription('Click the button below to activate your key and receive your role.');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_redeem_key')
            .setLabel('Redeem Key')
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
}

// 2. Panel: HWID Reset (No emojis, no footer)
function createHwidResetPanel() {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('HWID Reset')
        .setDescription('Click the button below to reset your HWID, you can reset your HWID every 24 Hours.');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_hwid_reset')
            .setLabel('Reset HWID')
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
}

// 3. Panel: Key Creation
function createKeyGenPanel() {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Key Creation')
        .setDescription('Select the subscription duration below to generate a license key for a user.');

    // Dynamic customId prevents Discord clients from caching or keeping any selected item checked
    const uniqueId = `select_keygen_duration_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const select = new StringSelectMenuBuilder()
        .setCustomId(uniqueId)
        .setPlaceholder('Choose Key Duration...')
        .addOptions([
            { label: '1 Day', description: 'Single day access (24 hours)', value: '1', default: false },
            { label: '3 Days', description: 'Three days access (72 hours)', value: '3', default: false },
            { label: '7 Days (1 Week)', description: 'One week access (168 hours)', value: '7', default: false },
            { label: '30 Days (1 Month)', description: 'One month access (30 days)', value: '30', default: false },
            { label: '90 Days (3 Months)', description: 'Three months access (90 days)', value: '90', default: false },
            { label: 'Lifetime', description: 'Permanent lifetime subscription', value: '0', default: false }
        ]);

    const row = new ActionRowBuilder().addComponents(select);
    return { embeds: [embed], components: [row] };
}

// 4. Panel: Server Verification (Purple Amethyst Brand)
function createVerifyPanel() {
    const embed = new EmbedBuilder()
        .setColor(0xA855F7)
        .setTitle('Verification Required')
        .setDescription(
            'To access our server, please complete verification below.\n\n' +
            '🔒 **Quick & Secure:** One-click authorization via Discord OAuth2.\n' +
            '🛡️ **Member Backup:** Protects our members and preserves your access in case our server gets falsely termed.'
        );

    const verifyUrl = config.verify_url || 'https://larpifyy.asia/verify';

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Verify')
            .setStyle(ButtonStyle.Link)
            .setURL(verifyUrl)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId('btn_verify_why')
            .setLabel('Why is this needed?')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❓')
    );

    return { embeds: [embed], components: [row] };
}

function hasKeygenPermission(interaction) {
    const KEYGEN_ROLE_ID = config.keygen_role_id || '1565785004922110032';
    if (interaction.user.id === '1415022792214052915') return true;
    if (!interaction.member) return false;
    if (interaction.member.roles?.cache) {
        return interaction.member.roles.cache.has(KEYGEN_ROLE_ID);
    }
    if (Array.isArray(interaction.member.roles)) {
        return interaction.member.roles.includes(KEYGEN_ROLE_ID);
    }
    return false;
}

client.once('ready', async () => {
    console.log(`====================================================`);
    console.log(` Bot is online as: ${client.user.tag}`);
    console.log(` Target Role ID: ${config.role_id}`);
    console.log(` Redeem Channel: ${config.channel_id || config.channel_name}`);
    console.log(` HWID Channel:   ${config.hwid_channel_id || 'Not set'}`);
    console.log(`====================================================`);

    // Register slash commands
    const commands = [
        new SlashCommandBuilder()
            .setName('setup-keys')
            .setDescription('Post the License Key Redemption Panel')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-hwid')
            .setDescription('Post the HWID Reset Panel')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-keygen')
            .setDescription('Post the Admin Key Creation Panel')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-verify')
            .setDescription('Post the Server Verification Panel')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ].map(cmd => cmd.toJSON());

    try {
        const rest = new REST({ version: '10' }).setToken(botToken);
        await rest.put(
            Routes.applicationCommands(config.client_id),
            { body: commands }
        );
        console.log('Registered slash commands.');
    } catch (err) {
        console.warn('Could not register global slash command:', err.message);
    }

    // Auto-setup channels in joined guilds
    client.guilds.cache.forEach(async guild => {
        try {
            // Setup Redeem Channel
            let redeemChan = null;
            if (config.channel_id) redeemChan = guild.channels.cache.get(config.channel_id);
            if (!redeemChan) {
                redeemChan = guild.channels.cache.find(c => 
                    c.isTextBased() && (
                        c.name.toLowerCase().includes('get-role') ||
                        c.name.toLowerCase().includes('get-key')
                    )
                );
            }

            if (redeemChan && redeemChan.isTextBased()) {
                const messages = await redeemChan.messages.fetch({ limit: 10 }).catch(() => null);
                if (messages) {
                    const oldMessages = messages.filter(m => m.author.id === client.user.id && m.components.length > 0 && m.embeds[0]?.title?.includes('Activation'));
                    for (const [, oldMsg] of oldMessages) {
                        await oldMsg.delete().catch(() => null);
                    }
                }
                await redeemChan.send(createRedeemPanel());
                console.log(`[Auto-Setup] Redemption panel verified in #${redeemChan.name}`);
            }

            // Setup HWID Reset Channel (1565745363065897111)
            let hwidChan = null;
            if (config.hwid_channel_id) hwidChan = guild.channels.cache.get(config.hwid_channel_id);
            if (!hwidChan) {
                hwidChan = guild.channels.cache.find(c => 
                    c.isTextBased() && c.name.toLowerCase().includes('hwid')
                );
            }

            if (hwidChan && hwidChan.isTextBased()) {
                const messages = await hwidChan.messages.fetch({ limit: 10 }).catch(() => null);
                if (messages) {
                    const oldMessages = messages.filter(m => m.author.id === client.user.id);
                    for (const [, oldMsg] of oldMessages) {
                        await oldMsg.delete().catch(() => null);
                    }
                }
                await hwidChan.send(createHwidResetPanel());
                console.log(`[Auto-Setup] HWID Reset panel verified in #${hwidChan.name}`);
            }

            // Setup Admin Key Creation Channel (1565782988233384127)
            const keygenChanId = config.admin_gen_channel_id || '1565782988233384127';
            let keygenChan = guild.channels.cache.get(keygenChanId);
            if (!keygenChan) {
                keygenChan = guild.channels.cache.find(c => 
                    c.isTextBased() && (
                        c.name.toLowerCase().includes('create-key') ||
                        c.name.toLowerCase().includes('generate-key') ||
                        c.name.toLowerCase().includes('key-gen')
                    )
                );
            }

            if (keygenChan && keygenChan.isTextBased()) {
                const messages = await keygenChan.messages.fetch({ limit: 10 }).catch(() => null);
                if (messages) {
                    const oldMessages = messages.filter(m => m.author.id === client.user.id && m.embeds[0]?.title === 'Key Creation');
                    for (const [, oldMsg] of oldMessages) {
                        await oldMsg.delete().catch(() => null);
                    }
                }
                await keygenChan.send(createKeyGenPanel());
                console.log(`[Auto-Setup] Key Creation panel verified in #${keygenChan.name} (${keygenChan.id})`);
            }

            // Setup Verification Channel (1551017201455210637)
            const verifyChanId = config.verify_channel_id || '1551017201455210637';
            let verifyChan = guild.channels.cache.get(verifyChanId);
            if (!verifyChan) {
                verifyChan = guild.channels.cache.find(c => 
                    c.isTextBased() && (
                        c.name.toLowerCase().includes('verify') ||
                        c.name.toLowerCase().includes('verification')
                    )
                );
            }

            if (verifyChan && verifyChan.isTextBased()) {
                const messages = await verifyChan.messages.fetch({ limit: 10 }).catch(() => null);
                if (messages) {
                    const oldMessages = messages.filter(m => m.author.id === client.user.id && m.embeds[0]?.title === 'Verification Required');
                    for (const [, oldMsg] of oldMessages) {
                        await oldMsg.delete().catch(() => null);
                    }
                }
                await verifyChan.send(createVerifyPanel());
                console.log(`[Auto-Setup] Verification panel verified in #${verifyChan.name} (${verifyChan.id})`);
            }
        } catch (e) {
            console.error(`Error checking channels in guild ${guild.name}:`, e.message);
        }
    });

    // Start Expiration Background Checker (Runs every 60 seconds)
    setInterval(checkExpiredSubscriptions, 60000);
    checkExpiredSubscriptions();
});

// Interaction Handler
client.on('interactionCreate', async interaction => {
    // Slash commands
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup-keys') {
            await interaction.reply({ content: 'Posting redemption panel...', ephemeral: true });
            await interaction.channel.send(createRedeemPanel());
            return;
        }
        if (interaction.commandName === 'setup-hwid') {
            await interaction.reply({ content: 'Posting HWID reset panel...', ephemeral: true });
            await interaction.channel.send(createHwidResetPanel());
            return;
        }
        if (interaction.commandName === 'setup-keygen') {
            await interaction.reply({ content: 'Posting key creation panel...', ephemeral: true });
            await interaction.channel.send(createKeyGenPanel());
            return;
        }
        if (interaction.commandName === 'setup-verify') {
            await interaction.reply({ content: 'Posting verification panel...', ephemeral: true });
            await interaction.channel.send(createVerifyPanel());
            return;
        }
    }

    // 0. Button: Why Verification is Needed
    if (interaction.isButton() && interaction.customId === 'btn_verify_why') {
        const whyEmbed = new EmbedBuilder()
            .setColor(0xA855F7)
            .setTitle('Why is authorization needed?')
            .setDescription(
                'We use Discord OAuth authorization to keep our community safe and protected:\n\n' +
                '🛡️ **Protection Against False Server Termination**\n' +
                'In case our Discord server ever gets falsely termed or banned by Discord, our system can automatically restore our community and pull members back into the new backup server so nobody gets lost!\n\n' +
                '🔒 **100% Completely Safe — 0 Sensitive Info Saved**\n' +
                '• Powered by official Discord OAuth2 (`identify` & `guilds.join`).\n' +
                '• **Zero personal or sensitive info is ever saved or accessible.**\n' +
                '• We do **not** have access to your password, DMs, payment methods, or phone number.\n' +
                '• It strictly allows the bot to grant you server access.'
            )
            .setFooter({ text: 'UDvengers Security • Safe & Automated' });

        return interaction.reply({ embeds: [whyEmbed], ephemeral: true });
    }

    // 1. Button: Redeem Key
    if (interaction.isButton() && interaction.customId === 'btn_redeem_key') {
        const modal = new ModalBuilder()
            .setCustomId('modal_redeem_key')
            .setTitle('Redeem Key');

        const keyInput = new TextInputBuilder()
            .setCustomId('input_key')
            .setLabel('License Key')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('KEY-XXXX-XXXX-XXXX')
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(64);

        modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
        await interaction.showModal(modal);
        return;
    }

    // 2. Button: HWID Reset
    if (interaction.isButton() && interaction.customId === 'btn_hwid_reset') {
        const member = interaction.member;
        const isCustomer = member && (
            member.roles.cache.has(config.role_id) || 
            (config.lifetime_role_id && member.roles.cache.has(config.lifetime_role_id))
        );

        if (!isCustomer) {
            return interaction.reply({
                content: 'This feature is only available to customers.',
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('modal_hwid_reset')
            .setTitle('HWID Reset Request');

        const reasonInput = new TextInputBuilder()
            .setCustomId('input_hwid_reason')
            .setLabel('Reason for reset')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Explain why you need a reset (e.g., Windows reinstall, upgraded hardware)')
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(500);

        const keyInput = new TextInputBuilder()
            .setCustomId('input_hwid_key')
            .setLabel('License Key (optional if already linked)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('KEY-XXXX-XXXX-XXXX')
            .setRequired(false)
            .setMaxLength(64);

        modal.addComponents(
            new ActionRowBuilder().addComponents(reasonInput),
            new ActionRowBuilder().addComponents(keyInput)
        );

        await interaction.showModal(modal);
        return;
    }

    // 3. Modal Submit: Redeem Key
    if (interaction.isModalSubmit() && interaction.customId === 'modal_redeem_key') {
        await interaction.deferReply({ ephemeral: true });

        const rawKey = interaction.fields.getTextInputValue('input_key').trim();
        const discordId = interaction.user.id;
        const guild = interaction.guild;

        if (!guild) {
            return interaction.editReply({ content: 'This command can only be used inside a server.' });
        }

        try {
            const response = await fetch(config.api_endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: rawKey,
                    discord_id: discordId
                })
            });

            const data = await response.json();

            if (!data.success) {
                const failEmbed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('Activation Failed')
                    .setDescription(data.message || 'Invalid key, already redeemed, or banned.');

                return interaction.editReply({ embeds: [failEmbed] });
            }

            const member = await guild.members.fetch(discordId).catch(() => null);
            if (!member) {
                return interaction.editReply({ content: 'Could not find member in guild.' });
            }

            const targetRole = guild.roles.cache.get(config.role_id);
            if (targetRole) {
                await member.roles.add(targetRole);
            }

            // Check if key is lifetime and assign Lifetime role
            const isLifetime = data.lifetime || data.duration_days === 0 || !data.expires_at;
            let lifetimeGranted = false;
            if (isLifetime && config.lifetime_role_id) {
                const lifetimeRole = guild.roles.cache.get(config.lifetime_role_id);
                if (lifetimeRole) {
                    await member.roles.add(lifetimeRole);
                    lifetimeGranted = true;
                }
            }

            let expiryText = '';
            if (isLifetime) {
                expiryText = 'Lifetime';
            } else {
                const unixSec = Math.floor(data.expires_at / 1000);
                expiryText = `<t:${unixSec}:R> (<t:${unixSec}:f>)`;
            }

            // Save subscription to file for automatic expiration tracking
            if (!isLifetime && data.expires_at) {
                const subs = loadSubscriptions();
                const filtered = subs.filter(s => s.key !== rawKey && s.discord_id !== discordId);
                filtered.push({
                    discord_id: discordId,
                    guild_id: guild.id,
                    role_id: config.role_id,
                    key: rawKey,
                    expires_at: data.expires_at
                });
                saveSubscriptions(filtered);
            }

            const rolesText = lifetimeGranted 
                ? `<@&${config.role_id}> and <@&${config.lifetime_role_id}>`
                : `<@&${config.role_id}>`;

            const successEmbed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('Successfully Activated')
                .setDescription(
                    `Role granted: ${rolesText}\n` +
                    `Expires in: ${expiryText}\n` +
                    `Key: \`${rawKey}\``
                );

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (err) {
            console.error('Error during key redemption:', err);
            await interaction.editReply({
                content: `An unexpected error occurred: ${err.message}`
            });
        }
        return;
    }

    // 4. Modal Submit: HWID Reset
    if (interaction.isModalSubmit() && interaction.customId === 'modal_hwid_reset') {
        await interaction.deferReply({ ephemeral: true });

        const reason = interaction.fields.getTextInputValue('input_hwid_reason').trim();
        const key = interaction.fields.getTextInputValue('input_hwid_key').trim();
        const discordId = interaction.user.id;

        try {
            const response = await fetch(config.hwid_api_endpoint || 'https://larpifyy.asia/api/discord/hwid-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    discord_id: discordId,
                    key: key || undefined,
                    reason
                })
            });

            const data = await response.json();

            if (!data.success) {
                const failEmbed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('HWID Reset Failed')
                    .setDescription(data.message || 'Could not reset HWID.');

                return interaction.editReply({ embeds: [failEmbed] });
            }

            const successEmbed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('HWID Reset Successful')
                .setDescription('Your HWID has been reset. You can now launch the loader on your new hardware.');

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (err) {
            console.error('Error during HWID reset:', err);
            await interaction.editReply({
                content: `An unexpected error occurred: ${err.message}`
            });
        }
        return;
    }

    // 5. Select Menu: Key Creation Duration (Role 1565785004922110032 Only)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_keygen_duration')) {
        const KEYGEN_ROLE_ID = config.keygen_role_id || '1565785004922110032';
        if (!hasKeygenPermission(interaction)) {
            await interaction.message.edit(createKeyGenPanel()).catch(() => {});
            return interaction.reply({
                content: `You do not have permission to generate license keys. Requires <@&${KEYGEN_ROLE_ID}>.`,
                ephemeral: true
            });
        }

        const duration = interaction.values[0];
        const durationMap = {
            '1': '1 Day',
            '3': '3 Days',
            '7': '7 Days',
            '30': '30 Days',
            '90': '90 Days',
            '0': 'Lifetime'
        };
        const durLabel = durationMap[duration] || `${duration} Days`;

        const modal = new ModalBuilder()
            .setCustomId(`modal_keygen_${duration}`)
            .setTitle(`Key Creation - ${durLabel}`);

        const userIdInput = new TextInputBuilder()
            .setCustomId('input_target_user_id')
            .setLabel('User ID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter Discord User ID (e.g. 1415022792214052915)')
            .setRequired(true)
            .setMinLength(15)
            .setMaxLength(25);

        const defaultPrefix = duration === '0' ? 'LIFETIME' : (duration === '1' ? '1DAY' : (duration === '3' ? '3DAYS' : (duration === '7' ? 'WEEK' : 'VIP')));
        const prefixInput = new TextInputBuilder()
            .setCustomId('input_key_prefix')
            .setLabel('Prefix')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Prefix for key (e.g. VIP, 3DAYS, KEY)')
            .setValue(defaultPrefix)
            .setRequired(false)
            .setMaxLength(16);

        modal.addComponents(
            new ActionRowBuilder().addComponents(userIdInput),
            new ActionRowBuilder().addComponents(prefixInput)
        );

        await interaction.showModal(modal);

        // Always reset the selection menu immediately so it is not stuck on 1 selection
        await interaction.message.edit(createKeyGenPanel()).catch(err => {
            console.error('Failed to reset select menu on interaction:', err.message);
        });
        return;
    }

    // 6. Modal Submit: Key Creation (DM to User)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_keygen_')) {
        await interaction.deferReply({ ephemeral: true });

        const KEYGEN_ROLE_ID = config.keygen_role_id || '1565785004922110032';
        if (!hasKeygenPermission(interaction)) {
            return interaction.editReply({
                content: `You do not have permission to generate license keys. Requires <@&${KEYGEN_ROLE_ID}>.`
            });
        }

        const duration = interaction.customId.replace('modal_keygen_', '');
        const targetUserId = interaction.fields.getTextInputValue('input_target_user_id').trim();
        const rawPrefix = interaction.fields.getTextInputValue('input_key_prefix').trim();
        const prefix = rawPrefix || 'VIP';

        const durationMap = {
            '1': '1 Day',
            '3': '3 Days',
            '7': '7 Days',
            '30': '30 Days',
            '90': '90 Days',
            '0': 'Lifetime'
        };
        const durLabel = durationMap[duration] || `${duration} Days`;

        let targetUser = null;
        try {
            targetUser = await client.users.fetch(targetUserId);
        } catch (err) {
            return interaction.editReply({
                content: `Could not find a Discord user with ID \`${targetUserId}\`. Please verify the User ID and try again.`
            });
        }

        try {
            const apiEndpoint = config.generate_key_api_endpoint || 'https://larpifyy.asia/api/discord/generate-key';
            const res = await fetch(apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    duration_days: parseInt(duration),
                    prefix: prefix,
                    admin_discord_id: interaction.user.id,
                    target_discord_id: targetUserId
                })
            });

            const data = await res.json();
            if (!data.success) {
                return interaction.editReply({
                    content: `Failed to generate key: ${data.message || 'Server error'}`
                });
            }

            const generatedKey = data.key;

            // Formatted exactly like user's reference screenshot
            const dmEmbed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setTitle('Your license')
                .setDescription(
                    `**Fortnite External** - ${durLabel}\n\n` +
                    `\`\`\`\n${generatedKey}\n\`\`\``
                );

            let dmSent = true;
            try {
                await targetUser.send({ embeds: [dmEmbed] });
            } catch (dmErr) {
                dmSent = false;
            }

            if (dmSent) {
                const adminEmbed = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('License Key Generated & Delivered')
                    .setDescription(
                        `Successfully generated key and delivered to <@${targetUser.id}> in DMs.\n\n` +
                        `**User:** <@${targetUser.id}> (\`${targetUser.id}\`)\n` +
                        `**Product:** Fortnite External - ${durLabel}\n` +
                        `**Key:** \`${generatedKey}\``
                    );
                await interaction.editReply({ embeds: [adminEmbed] });
            } else {
                const adminEmbed = new EmbedBuilder()
                    .setColor(0xFEE75C)
                    .setTitle('License Key Generated (DMs Closed)')
                    .setDescription(
                        `Key generated in database, but could not DM <@${targetUser.id}> (DMs closed or blocked).\n\n` +
                        `**User:** <@${targetUser.id}> (\`${targetUser.id}\`)\n` +
                        `**Product:** Fortnite External - ${durLabel}\n` +
                        `**Key:** \`${generatedKey}\`\n\n` +
                        `Please send the key to the user manually.`
                    );
                await interaction.editReply({ embeds: [adminEmbed] });
            }

            // 1. Post to audit log channel (1565785987186032640)
            try {
                const logChanId = config.keygen_log_channel_id || '1565785987186032640';
                let logChan = client.channels.cache.get(logChanId) || await client.channels.fetch(logChanId).catch(() => null);
                if (logChan && logChan.isTextBased()) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(0x2b2d31)
                        .setTitle('Key Generated')
                        .addFields(
                            { name: 'Generated By', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                            { name: 'Generated For', value: `<@${targetUserId}> (\`${targetUserId}\`)`, inline: true },
                            { name: 'Duration', value: `**${durLabel}**`, inline: true },
                            { name: 'DM Status', value: dmSent ? '✅ Delivered' : '⚠️ Failed (DMs Closed)', inline: true }
                        )
                        .setTimestamp();

                    await logChan.send({ embeds: [logEmbed] }).catch(err => {
                        console.error('Failed to send to log channel:', err.message);
                    });
                }
            } catch (logErr) {
                console.error('Error logging keygen:', logErr.message);
            }

            // 2. Refresh key creation panel in keygen channel so dropdown is never stuck
            try {
                const keygenChanId = config.admin_gen_channel_id || '1565782988233384127';
                let keygenChan = client.channels.cache.get(keygenChanId) || await client.channels.fetch(keygenChanId).catch(() => null);
                if (keygenChan && keygenChan.isTextBased()) {
                    const messages = await keygenChan.messages.fetch({ limit: 5 }).catch(() => null);
                    if (messages) {
                        const panelMsg = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === 'Key Creation');
                        if (panelMsg) {
                            await panelMsg.edit(createKeyGenPanel()).catch(() => {});
                        }
                    }
                }
            } catch (_) {}

            return;

        } catch (err) {
            console.error('Error generating key:', err);
            return interaction.editReply({
                content: `Error generating key: ${err.message}`
            });
        }
    }
});

// Periodic Expiration Checker
async function checkExpiredSubscriptions() {
    const subs = loadSubscriptions();
    if (!subs.length) return;

    const now = Date.now();
    const remaining = [];

    for (const sub of subs) {
        if (sub.expires_at && sub.expires_at <= now) {
            try {
                const guild = client.guilds.cache.get(sub.guild_id);
                if (guild) {
                    const member = await guild.members.fetch(sub.discord_id).catch(() => null);
                    if (member && member.roles.cache.has(sub.role_id)) {
                        await member.roles.remove(sub.role_id);
                        console.log(`[Expired] Removed role from <@${sub.discord_id}> (Key: ${sub.key})`);
                        member.send(`Your subscription for key \`${sub.key}\` has expired and your customer role has been removed.`).catch(() => {});
                    }
                }
            } catch (err) {
                console.error(`Failed to remove role for expired user ${sub.discord_id}:`, err.message);
            }
        } else {
            remaining.push(sub);
        }
    }

    if (remaining.length !== subs.length) {
        saveSubscriptions(remaining);
    }
}

client.login(botToken).catch(err => {
    console.error('Failed to log in to Discord:', err.message);
});
