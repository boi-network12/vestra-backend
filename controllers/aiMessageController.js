const axios = require('axios');
const validator = require('validator');
const { parse, isValid, isAfter, subYears } = require('date-fns');
const { getName: getCountryName } = require('country-list');
const User = require('../model/userModel');

// Environment variables
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
const UNSPLASH_API_URL = 'https://api.unsplash.com/search/photos';
const UNSPLASH_ACCESS_KEY = "tH4JRusUGQ5AFfVnzzap3K0_YY5GjwjXojLf-eO4agg";

const aiMessage = async (req, res) => {
  try {
    const { message, userName } = req.body;

    // Fetch user data
    const user = await User.findById(req.user.id).select(
      'name username email bio interests country dateOfBirth link profilePicture settings lastActive'
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Define the system prompt with user context
    const systemPrompt = `
      You are Vestra AI, a friendly and helpful assistant created for the Vestra app. 
      You are talking to ${user.name} (username: ${user.username}). 
      User details:
      - Bio: ${user.bio || 'Not provided'}
      - Interests: ${user.interests.join(', ') || 'None'}
      - Country: ${user.country || 'Not provided'}
      - Date of Birth: ${user.dateOfBirth ? user.dateOfBirth.toISOString() : 'Not provided'}
      - Link: ${user.link || 'Not provided'}
      - Profile Picture: ${user.profilePicture || 'Not set'}
      - Notification Settings: ${JSON.stringify(user.settings.notifications)}
      - Privacy Settings: ${JSON.stringify(user.settings.privacy)}
      - Last Active: ${user.lastActive.toISOString()}
      Always respond as Vestra AI, avoid mentioning any other identity, and tailor responses based on the user's data when relevant.
      
      If the user asks to update their profile, handle the following commands:
      - "update my bio to [new bio]": Update the bio (max 160 characters).
      - "update my country to [country]": Update the country (must be a valid country name).
      - "update my date of birth to [date]": Update the date of birth (must be a valid date, user must be at least 13 years old).
      - "update my link to [URL]": Update the link (must be a valid URL).
      - "update my profile picture to [query]" or "set my profile picture to [query]": Search for an image based on the query, validate it, and update the profile picture URL.
      Confirm the action and indicate that the update will be processed. For example:
      - User: "update my bio to I love coding"
      - Response: "Got it! I've updated your bio to 'I love coding'. Anything else you'd like to change?"
      If the request is ambiguous (e.g., "update my profile"), ask for clarification, like: "Could you specify what you'd like to update? For example, your bio, country, or profile picture."
      Do not process updates for sensitive fields like email or password without additional verification steps.
      For profile picture updates, search for an appropriate image based on the query and ensure it's a valid image URL.
    `;

    // Check for update requests
    const updateBioRegex = /update my bio\s+(.+)/i;
    const updateCountryRegex = /update my country\s+(.+)/i;
    const updateDateOfBirthRegex = /update my date of birth\s+(.+)/i;
    const updateLinkRegex = /update my link\s+(.+)/i;
    const updateProfilePictureRegex = /(?:update|set) my profile picture\s+(.+)/i;

    // Bio update
    if (updateBioRegex.test(message)) {
      const match = message.match(updateBioRegex);
      const newBio = match[1].trim();

      if (newBio.length > 160) {
        return res.json({ text: 'Sorry, the bio is too long. Please keep it under 160 characters.' });
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        { bio: newBio },
        { new: true, runValidators: true }
      ).select('-password -verificationCode -verificationExpires');

      if (!updatedUser) {
        return res.status(500).json({ error: 'Failed to update bio' });
      }

      return res.json({ text: `Got it! I've updated your bio to "${newBio}". Anything else you'd like to change?` });
    }

    // Country update
    if (updateCountryRegex.test(message)) {
      const match = message.match(updateCountryRegex);
      const newCountry = match[1].trim();

      // Validate country
      const validCountry = getCountryName(newCountry);
      if (!validCountry) {
        return res.json({ text: 'Sorry, that country is not valid. Please provide a valid country name.' });
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        { country: validCountry },
        { new: true, runValidators: true }
      ).select('-password -verificationCode -verificationExpires');

      if (!updatedUser) {
        return res.status(500).json({ error: 'Failed to update country' });
      }

      return res.json({ text: `Got it! I've updated your country to "${validCountry}". Anything else you'd like to change?` });
    }

    // Date of Birth update
    if (updateDateOfBirthRegex.test(message)) {
      const match = message.match(updateDateOfBirthRegex);
      const dateString = match[1].trim();

      // Parse and validate date
      const parsedDate = parse(dateString, 'yyyy-MM-dd', new Date());
      if (!isValid(parsedDate)) {
        return res.json({ text: 'Sorry, the date format is invalid. Please use YYYY-MM-DD (e.g., 1990-01-01).' });
      }

      // Ensure user is at least 13 years old
      const minAgeDate = subYears(new Date(), 13);
      if (isAfter(parsedDate, minAgeDate)) {
        return res.json({ text: 'Sorry, you must be at least 13 years old to update your date of birth.' });
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        { dateOfBirth: parsedDate },
        { new: true, runValidators: true }
      ).select('-password -verificationCode -verificationExpires');

      if (!updatedUser) {
        return res.status(500).json({ error: 'Failed to update date of birth' });
      }

      return res.json({ text: `Got it! I've updated your date of birth to "${dateString}". Anything else you'd like to change?` });
    }

    // Link update
    if (updateLinkRegex.test(message)) {
      const match = message.match(updateLinkRegex);
      const newLink = match[1].trim();

      // Validate URL
      if (!validator.isURL(newLink)) {
        return res.json({ text: 'Sorry, the link is not a valid URL. Please provide a valid URL.' });
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        { link: newLink },
        { new: true, runValidators: true }
      ).select('-password -verificationCode -verificationExpires');

      if (!updatedUser) {
        return res.status(500).json({ error: 'Failed to update link' });
      }

      return res.json({ text: `Got it! I've updated your link to "${newLink}". Anything else you'd like to change?` });
    }

    // Profile Picture update
    if (updateProfilePictureRegex.test(message)) {
      const match = message.match(updateProfilePictureRegex);
      const query = match[1].trim();

      try {
        // Fetch image from Unsplash API
        const response = await axios.get(UNSPLASH_API_URL, {
          params: {
            query,
            per_page: 1,
            orientation: 'squarish',
          },
          headers: {
            Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
          },
        });

        const image = response.data.results[0];
        if (!image) {
          return res.json({ text: `Sorry, I couldn't find an image for "${query}". Try a different query.` });
        }

        const imageUrl = image.urls.regular;

        // Validate image format
        if (!imageUrl.match(/\.(jpg|jpeg|png|gif)$/i)) {
          return res.json({ text: 'Sorry, the image format is not supported. Please try a different query.' });
        }

        // Update profile picture
        const updatedUser = await User.findByIdAndUpdate(
          req.user.id,
          { profilePicture: imageUrl },
          { new: true, runValidators: true }
        ).select('-password -verificationCode -verificationExpires');

        if (!updatedUser) {
          return res.status(500).json({ error: 'Failed to update profile picture' });
        }

        return res.json({
          text: `Got it! I've updated your profile picture to an image of "${query}". Anything else you'd like to change?`,
          imageUrl,
        });
      } catch (err) {
        console.error('Profile picture update error:', err);
        return res.json({ text: 'Sorry, I encountered an error while updating your profile picture. Please try again later.' });
      }
    }

    // Handle ambiguous update requests
    if (message.toLowerCase().includes('update my profile') || message.toLowerCase().includes('change my profile')) {
      return res.json({
        text: "Could you specify what you'd like to update? For example, your bio, country, date of birth, link, or profile picture.",
      });
    }

    // Handle general AI queries
    const prompt = `${systemPrompt}\n\nUser: ${message}`;

    const response = await axios.post(
      `${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const aiResponse = response.data.candidates[0]?.content?.parts[0]?.text || 'No response';
    res.json({ text: aiResponse });
  } catch (error) {
    console.error('AI message error:', error);
    res.status(500).json({ error: 'Failed to get AI response' });
  }
};

module.exports = { aiMessage };