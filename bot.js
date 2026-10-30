const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
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
        .setDescription(
            'Click the button below to reset your HWID.\n\n' +
            '• You can reset your HWID once every 24 hours.\n' +
            '• You must provide a valid reason.\n' +
            '• Submitting false or invalid reasons may result in your key being banned.'
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_hwid_reset')
            .setLabel('Reset HWID')
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
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
                .setDescription(
                    'Your HWID has been reset. You can now launch the loader on your new hardware.\n\n' +
                    '• Next reset available in 24 hours.\n' +
                    `• Key: \`${data.key}\``
                );

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (err) {
            console.error('Error during HWID reset:', err);
            await interaction.editReply({
                content: `An unexpected error occurred: ${err.message}`
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
