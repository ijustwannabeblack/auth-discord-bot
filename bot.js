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

// Create Simple Redeem Embed and Button (No footer, no emojis)
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

client.once('ready', async () => {
    console.log(`====================================================`);
    console.log(` Bot is online as: ${client.user.tag}`);
    console.log(` Target Role ID: ${config.role_id}`);
    console.log(` Target Channel: ${config.channel_id || config.channel_name}`);
    console.log(`====================================================`);

    // Register /setup-keys slash command
    const commands = [
        new SlashCommandBuilder()
            .setName('setup-keys')
            .setDescription('Post the License Key Redemption Panel in this channel')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ].map(cmd => cmd.toJSON());

    try {
        const rest = new REST({ version: '10' }).setToken(botToken);
        await rest.put(
            Routes.applicationCommands(config.client_id),
            { body: commands }
        );
        console.log('Registered /setup-keys slash command.');
    } catch (err) {
        console.warn('Could not register global slash command:', err.message);
    }

    // Auto-search and post in the designated channel
    client.guilds.cache.forEach(async guild => {
        try {
            let channel = null;
            if (config.channel_id) {
                channel = guild.channels.cache.get(config.channel_id);
            }
            if (!channel) {
                channel = guild.channels.cache.find(c => 
                    c.isTextBased() && (
                        c.name.toLowerCase().includes('get-role') ||
                        c.name.toLowerCase().includes('get-key') ||
                        c.name.toLowerCase().includes('get key')
                    )
                );
            }

            if (channel && channel.isTextBased()) {
                // Remove previous bot messages in this channel to keep it clean
                const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
                if (messages) {
                    const oldMessages = messages.filter(m => m.author.id === client.user.id);
                    for (const [, oldMsg] of oldMessages) {
                        await oldMsg.delete().catch(() => null);
                    }
                }
                await channel.send(createRedeemPanel());
                console.log(`[Auto-Setup] Clean redemption panel posted in #${channel.name} (${guild.name})`);
            }
        } catch (e) {
            console.error(`Error checking channel in guild ${guild.name}:`, e.message);
        }
    });

    // Start Expiration Background Checker (Runs every 60 seconds)
    setInterval(checkExpiredSubscriptions, 60000);
    checkExpiredSubscriptions();
});

// Slash Command Handler
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup-keys') {
            await interaction.reply({ content: 'Posting redemption panel...', ephemeral: true });
            await interaction.channel.send(createRedeemPanel());
        }
        return;
    }

    // Button Click Handler -> Open Modal
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

        const firstActionRow = new ActionRowBuilder().addComponents(keyInput);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);
        return;
    }

    // Modal Submission Handler -> Validate Key via Cloudflare Edge
    if (interaction.isModalSubmit() && interaction.customId === 'modal_redeem_key') {
        await interaction.deferReply({ ephemeral: true });

        const rawKey = interaction.fields.getTextInputValue('input_key').trim();
        const discordId = interaction.user.id;
        const guild = interaction.guild;

        if (!guild) {
            return interaction.editReply({ content: 'This command can only be used inside a server.' });
        }

        try {
            // Call Cloudflare API Endpoint
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

            // Successfully validated! Grant role
            const member = await guild.members.fetch(discordId).catch(() => null);
            if (!member) {
                return interaction.editReply({ content: 'Could not find member in guild.' });
            }

            const targetRole = guild.roles.cache.get(config.role_id);
            if (!targetRole) {
                return interaction.editReply({ content: `Target role (${config.role_id}) was not found in this server.` });
            }

            // Assign Customer role
            await member.roles.add(targetRole);

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

            // Calculate expiration formatting
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

// Fallback message command for testing: "!setup"
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.content.trim() === '!setup' && message.member && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await message.channel.send(createRedeemPanel());
        await message.reply({ content: 'Redemption panel created.' });
    }
});

client.login(botToken).catch(err => {
    console.error('Failed to log in to Discord:', err.message);
});
